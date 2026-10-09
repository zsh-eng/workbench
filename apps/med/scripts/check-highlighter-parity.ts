import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, platform, arch } from "node:os";
import { createServer } from "node:http";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { chromium } from "playwright";
import { build } from "vite";
import {
  diagnosticTheme,
  themeNames,
  twinkleplop,
  normalizedRuns,
  compareRuns,
  renderFile,
  html,
} from "../helpers/highlighting/parity";

const outputOption = process.argv.indexOf("--output");
const output = resolve(
  outputOption < 0 ? ".benchmarks/language-parity/results" : process.argv[outputOption + 1],
);
await mkdir(output, { recursive: true });
const pinnedVersions = { shiki: "4.4.3", "@twinkleplop/core": "0.2.1", "@pierre/diffs": "1.4.3" };
for (const [name, version] of Object.entries(pinnedVersions)) {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.resolve(name)), "utf8"),
  );
  if (metadata.version !== version)
    throw new Error(`Re-audit the oracle before upgrading ${name}: ${metadata.version}`);
}
const implementationFiles = [
  "src/web/highlighting/adapter.ts",
  "src/web/highlighting/runtime.ts",
  "src/web/highlighting/languages.ts",
  "src/web/highlighting/languages/c-family.ts",
  "src/web/highlighting/languages/java.ts",
  "src/web/highlighting/languages/cpp.ts",
];
const implementationHashes = Object.fromEntries(
  await Promise.all(
    implementationFiles.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ]),
  ),
);
const reference = await createHighlighter({
  themes: ["github-light", "github-dark", diagnosticTheme],
  langs: ["java", "cpp"],
  engine: createJavaScriptRegexEngine(),
});
const actual = await twinkleplop(themeNames.map((n) => reference.getTheme(n)));
const fixtures = await Promise.all(
  ["java.java", "java-edge.java", "cpp.cpp", "cpp-edge.cpp", "java-doc.java", "cpp-raw.cpp"].map(
    async (name) => ({
      name,
      lang: name.endsWith("java") ? "java" : "cpp",
      source: await readFile(`tests/fixtures/highlighting/${name}`, "utf8"),
      fixture: true,
    }),
  ),
);
const corpusPath = resolve(".benchmarks/language-parity/corpus");
let manifest: { name: string; url: string; revision: string; sha256: string }[] = [];
try {
  manifest = JSON.parse(await readFile(join(corpusPath, "manifest.json"), "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const corpus = await Promise.all(
  (process.argv.includes("--fixtures-only") ? [] : manifest).map(async (item) => {
    const source = await readFile(join(corpusPath, item.name), "utf8");
    if (createHash("sha256").update(source).digest("hex") !== item.sha256)
      throw new Error(`Corpus hash changed: ${item.name}`);
    return {
      name: item.name,
      lang: item.name.endsWith("java") ? "java" : "cpp",
      source,
      fixture: false,
    };
  }),
);
const report = {
  date: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  machine: { cpu: cpus()[0].model, platform: platform(), arch: arch() },
  versions: { shiki: "4.4.3", twinkleplop: "0.2.1", pierre: "1.4.3" },
  referenceEngine: "shiki-javascript",
  implementationHashes,
  manifest,
  quality: [] as unknown[],
  benchmark: [] as unknown[],
};
const browser = await chromium.launch({ headless: true });
let server: ReturnType<typeof createServer> | undefined;
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const font = (await readFile("public/fonts/PaperMono-Variable.woff2")).toString("base64");
const fontCSS = `@font-face{font-family:MedMono;src:url(data:font/woff2;base64,${font}) format('woff2')} .code{font-family:MedMono,monospace;font-variant-ligatures:none}`;
const panels: string[] = [];
let failures = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 1,
  });
  for (const file of [...fixtures, ...corpus])
    for (const theme of themeNames) {
      const t = reference.getTheme(theme);
      const a = renderFile(file.source, file.lang, theme, reference),
        b = renderFile(file.source, file.lang, theme, actual);
      const differences = compareRuns(
        normalizedRuns(a.code, t.fg, t.bg),
        normalizedRuns(b.code, t.fg, t.bg),
      );
      const id = `${file.name}-${theme}`;
      const positions = differences.map((d) => {
        const prefix = file.source.slice(0, d.start);
        return {
          ...d,
          line: prefix.split("\n").length,
          column: d.start - prefix.lastIndexOf("\n"),
        };
      });
      await writeFile(join(output, `${id}.json`), JSON.stringify(positions, null, 2) + "\n");
      let pixelDifference: number | undefined;
      const markup = (code: typeof a.code) =>
        `<div class="code" style="color:${t.fg};background:${t.bg}">${code.map((line) => `<div class="line">${html(line)}</div>`).join("")}</div>`;
      if (file.fixture) {
        const images: Buffer[] = [];
        for (const [engine, code] of [
          ["shiki", a.code],
          ["twinkleplop", b.code],
        ] as const) {
          await page.setContent(
            `<style>${fontCSS}body{margin:0}.code{font:14px/22px MedMono,monospace;font-variant-ligatures:none;white-space:pre;box-sizing:border-box;width:960px;padding:16px}.line{height:22px}</style>${markup(code)}`,
          );
          await page.evaluate(() => document.fonts.ready);
          images.push(
            await page.locator(".code").screenshot({ path: join(output, `${id}-${engine}.png`) }),
          );
        }
        const pixel = await page.evaluate(
          async ([a, b]) => {
            async function load(data: string) {
              const i = new Image();
              i.src = `data:image/png;base64,${data}`;
              await i.decode();
              return i;
            }
            const [x, y] = await Promise.all([load(a), load(b)]);
            if (x.width !== y.width || x.height !== y.height)
              throw new Error("Screenshot geometry changed");
            const canvas = document.createElement("canvas");
            canvas.width = x.width;
            canvas.height = x.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(x, 0, 0);
            const p = ctx.getImageData(0, 0, x.width, x.height);
            ctx.drawImage(y, 0, 0);
            const q = ctx.getImageData(0, 0, x.width, x.height);
            let changed = 0;
            for (let i = 0; i < p.data.length; i += 4) {
              const delta = Math.max(
                ...[0, 1, 2, 3].map((j) => Math.abs(p.data[i + j] - q.data[i + j])),
              );
              if (delta > 12) {
                changed++;
                p.data[i] = 255;
                p.data[i + 1] = 0;
                p.data[i + 2] = 100;
              } else {
                p.data[i] = p.data[i + 1] = p.data[i + 2] = 24;
              }
              p.data[i + 3] = 255;
            }
            ctx.putImageData(p, 0, 0);
            return { changed, pixels: x.width * x.height, png: canvas.toDataURL().split(",")[1] };
          },
          images.map((b) => b.toString("base64")),
        );
        pixelDifference = pixel.changed / pixel.pixels;
        await writeFile(join(output, `${id}-difference.png`), Buffer.from(pixel.png, "base64"));
      }
      const passed =
        differences.length === 0 && (pixelDifference === undefined || pixelDifference <= 0.0005);
      if (!passed) failures++;
      report.quality.push({
        file: file.name,
        theme,
        bytes: Buffer.byteLength(file.source),
        sha256: createHash("sha256").update(file.source).digest("hex"),
        passed,
        mismatchRanges: differences.length,
        mismatchedCharacters: differences.reduce((n, d) => n + d.end - d.start, 0),
        pixelDifference,
        details: `${id}.json`,
      });
      console.log(
        `${passed ? "PASS" : "DIFF"} ${id}: ${differences.length} ranges${pixelDifference === undefined ? "" : `, ${(100 * pixelDifference).toFixed(4)}% pixels`}`,
      );
      panels.push(
        `<h2>${escape(id)} — ${passed ? "PASS" : "DIFFERENCES"}</h2><p><a href="${id}.json">${differences.length} mismatched ranges</a></p><div class="pair"><section><h3>Shiki</h3>${markup(a.code.slice(0, 80))}</section><section><h3>Twinkleplop</h3>${markup(b.code.slice(0, 80))}</section></div>${file.fixture ? `<details><summary>Pixel difference</summary><img src="${id}-difference.png"></details>` : "<p>Preview: first 80 lines. JSON compares the complete file.</p>"}`,
      );
    }
  await writeFile(
    join(output, "comparison.html"),
    `<!doctype html><meta charset="utf-8"><title>med highlighter parity</title><style>${fontCSS}body{background:#181818;color:#eee;font:14px system-ui;padding:24px}a{color:#93c5fd}.pair{display:flex;gap:16px}.pair section{width:50%;overflow:auto}.code{font:14px/22px MedMono,monospace;font-variant-ligatures:none;white-space:pre;padding:16px}.line{height:22px}img{max-width:100%}</style><h1>Shiki / Twinkleplop rendered comparison</h1><p>Zero unexplained style differences required. Whitespace text, backgrounds and decorations are retained; invisible foreground ink on whitespace is ignored.</p>${panels.join("\n")}`,
  );
  // Quality comparison is complete before any timing begins.
  if (process.argv.includes("--benchmark")) {
    for (const engine of ["shiki", "twinkleplop"]) {
      await build({
        configFile: false,
        logLevel: "error",
        resolve: {
          alias: { "med-benchmark-engine": resolve(`helpers/highlighting/engine-${engine}.ts`) },
        },
        build: {
          target: "esnext",
          outDir: join(output, engine),
          emptyOutDir: true,
          minify: true,
          lib: {
            entry: resolve("helpers/highlighting/benchmark-worker.ts"),
            formats: ["es"],
            fileName: () => "worker.js",
          },
        },
      });
    }
    server = createServer(async (req, res) => {
      try {
        const path = req.url?.slice(1) ?? "";
        if (!/^(shiki|twinkleplop)\/[a-zA-Z0-9_.-]+\.js$/.test(path)) {
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><title>med benchmark</title>");
          return;
        }
        res.setHeader("Content-Type", "text/javascript");
        res.end(await readFile(join(output, path)));
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((accept) => server!.listen(0, "127.0.0.1", accept));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    await page.goto(`http://127.0.0.1:${address.port}`);
    for (let round = 0; round < 3; round++)
      for (const file of corpus.length ? corpus : fixtures)
        for (const engine of round % 2 ? ["twinkleplop", "shiki"] : ["shiki", "twinkleplop"]) {
          console.log(`Benchmark ${round + 1} ${file.name} ${engine}`);
          const timing = await page.evaluate(
            ({ engine, source, lang }) =>
              new Promise((accept, reject) => {
                const start = performance.now(),
                  worker = new Worker(`/${engine}/worker.js`, { type: "module" });
                let readyMs = 0,
                  initializationMs = 0;
                const timeout = setTimeout(() => {
                  worker.terminate();
                  reject(new Error("Benchmark timed out"));
                }, 120000);
                const done = (value: unknown, error?: string) => {
                  clearTimeout(timeout);
                  worker.terminate();
                  if (error) reject(new Error(error));
                  else accept(value);
                };
                worker.onerror = (e) => done(null, e.message);
                worker.onmessage = ({ data }) => {
                  if (data.ready) {
                    readyMs = performance.now() - start;
                    initializationMs = data.initializationMs;
                    worker.postMessage({ source, lang });
                  } else if (data.error) done(null, data.error);
                  else done({ readyMs, initializationMs, ...data });
                };
              }),
            { engine, source: file.source, lang: file.lang },
          );
          report.benchmark.push({ round, engine, file: file.name, timing });
          await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        }
  }
  await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
  actual.dispose();
  reference.dispose();
  await browser.close();
  await new Promise<void>((accept) => (server ? server.close(() => accept()) : accept()));
}
console.log(`Report: ${join(output, "comparison.html")} (${failures} failing comparisons)`);
if (failures && !process.argv.includes("--report-only")) process.exitCode = 1;
