import { chromium } from "playwright";
import { build } from "vite";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
const app = resolve(fileURLToPath(new URL("../../", import.meta.url)));
await mkdir(join(app, "cutover.local/storage-benchmark"), { recursive: true });
const pkg = app + "/node_modules/@sqlite.org/sqlite-wasm/dist";
const temp = await mkdtemp(app + "/cutover.local/opfs-bundle-");
const size = (b) => ({
  raw: b.length,
  gzip9: gzipSync(b, { level: 9 }).length,
  brotli11: brotliCompressSync(b, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
});
try {
  await writeFile(
    join(temp, "worker.js"),
    `import init from ${JSON.stringify(pkg + "/index.mjs")};\nself.onmessage=async()=>{const sqlite=await init();const pool=await sqlite.installOpfsSAHPoolVfs({name:'spaced-size-probe'});const db=new pool.OpfsSAHPoolDb('/probe.sqlite');self.postMessage(db.selectValue('SELECT sqlite_version()'));db.close();};\n`,
  );
  await build({
    configFile: false,
    root: temp,
    publicDir: false,
    logLevel: "warn",
    build: {
      target: "esnext",
      minify: "esbuild",
      outDir: join(temp, "dist"),
      assetsInlineLimit: 0,
      rollupOptions: {
        input: join(temp, "worker.js"),
        output: { format: "es", entryFileNames: "sqlite-worker.js" },
      },
    },
  });
  async function scan(dir) {
    let out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await scan(p)));
      else
        out.push({
          file: p.slice(temp.length + 1),
          ...size(await readFile(p)),
        });
    }
    return out;
  }
  const assets = await scan(join(temp, "dist"));
  const appAssets = [];
  for (const name of await readdir(app + "/dist/assets"))
    if (/\.(js|css)$/.test(name))
      appAssets.push({
        file: name,
        ...size(await readFile(app + "/dist/assets/" + name)),
      });
  const total = (arr) =>
    arr.reduce(
      (a, x) => {
        for (const k of ["raw", "gzip9", "brotli11"]) a[k] += x[k];
        return a;
      },
      { raw: 0, gzip9: 0, brotli11: 0 },
    );
  const result = {
    package: "@sqlite.org/sqlite-wasm@3.53.4-build1",
    method:
      "Vite 6 production minification of a minimal SAH-pool worker; bytes compressed independently per emitted file; gzip level 9, Brotli quality 11; no production adapter",
    assets,
    total: total(assets),
    currentAppJSAndCSS: appAssets,
    currentAppJSAndCSSTotal: total(appAssets),
    unminifiedPackageJS: size(await readFile(pkg + "/index.mjs")),
    optionalProxy: size(await readFile(pkg + "/sqlite3-opfs-async-proxy.js")),
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/favicon.ico")
        return new Response(null, { status: 204 });
      const headers = {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      };
      if (pathname === "/")
        return new Response("<!doctype html><title>SQLite size probe</title>", {
          headers: { ...headers, "Content-Type": "text/html" },
        });
      if (!assets.some((a) => a.file === "dist" + pathname))
        return new Response("Not found", { status: 404 });
      return new Response(Bun.file(join(temp, "dist", pathname)), { headers });
    },
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const fetched = [];
    page.on("response", (r) =>
      fetched.push({ path: new URL(r.url()).pathname, status: r.status() }),
    );
    await page.goto("http://127.0.0.1:" + server.port);
    result.runtimeVersion = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const w = new Worker("/sqlite-worker.js", { type: "module" });
          const timer = setTimeout(() => {
            w.terminate();
            reject(Error("timeout"));
          }, 30000);
          w.onmessage = ({ data }) => {
            clearTimeout(timer);
            w.terminate();
            resolve(data);
          };
          w.onerror = (e) => {
            clearTimeout(timer);
            w.terminate();
            reject(Error(e.message));
          };
          w.postMessage({});
        }),
    );
    result.observedRequests = [...fetched];
    result.loadedAssets = assets.filter((a) =>
      fetched.some(
        (f) => f.path === a.file.replace(/^dist/, "") && f.status === 200,
      ),
    );
    result.loadedTotal = total(result.loadedAssets);
    fetched.length = 0;
    result.sahOnlyRuntimeVersion = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const w = new Worker(
            "/sqlite-worker.js?opfs-disable&opfs-wl-disable",
            { type: "module" },
          );
          const timer = setTimeout(() => {
            w.terminate();
            reject(Error("timeout"));
          }, 30000);
          w.onmessage = ({ data }) => {
            clearTimeout(timer);
            w.terminate();
            resolve(data);
          };
          w.onerror = (e) => {
            clearTimeout(timer);
            w.terminate();
            reject(Error(e.message));
          };
          w.postMessage({});
        }),
    );
    result.sahOnlyRequests = [...fetched];
    result.sahOnlyAssets = assets.filter((a) =>
      fetched.some(
        (f) => f.path === a.file.replace(/^dist/, "") && f.status === 200,
      ),
    );
    result.sahOnlyTotal = total(result.sahOnlyAssets);
  } finally {
    await browser?.close();
    server.stop(true);
  }
  await writeFile(
    join(
      app,
      "cutover.local/storage-benchmark/opfs-bundle-" + Date.now() + ".json",
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
