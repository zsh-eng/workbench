// Production editor check. Uses disposable copies; never edits the user's checkout.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const corpus = resolve(".benchmarks/bun-large-ui/corpus/http2.ts");
let source;
try {
  source = await readFile(corpus, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const response = await fetch(
    "https://raw.githubusercontent.com/oven-sh/bun/26e7a4b3690dce60d4dcd7f47a12b531deb00837/src/js/node/http2.ts",
  );
  if (!response.ok) throw new Error(`Corpus download failed: ${response.status}`);
  source = await response.text();
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "5005c4fd7044965e6034e7bea6a2e4f9df239e18f906c45a355c88062ffc83ed",
  );
  await mkdir(dirname(corpus), { recursive: true });
  await writeFile(corpus, source);
}
assert.equal(
  createHash("sha256").update(source).digest("hex"),
  "5005c4fd7044965e6034e7bea6a2e4f9df239e18f906c45a355c88062ffc83ed",
);
const temporary = await realpath(await mkdtemp(join(tmpdir(), "med-editing-")));
const repo = join(temporary, "bun"),
  primary = join(temporary, "primary");
const path = "src/js/node/http2.ts";
const output = resolve(".benchmarks/file-editing");
await mkdir(output, { recursive: true });
let host, browser, page;
try {
  for (const root of [repo, primary]) {
    await mkdir(root, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await writeFile(join(root, "README.md"), "Disposable med editing fixture.\n");
  }
  await mkdir(join(repo, "src/js/node"), { recursive: true });
  await writeFile(join(repo, path), source);
  for (const root of [repo, primary]) {
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=med",
      "-c",
      "user.email=med@localhost",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Fixture",
    ]);
  }
  host = spawn(
    process.execPath,
    [
      resolve("dist/cli.js"),
      primary,
      repo,
      "--port",
      "0",
      "--no-open",
      "--state-dir",
      join(temporary, "state"),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_ZOEKT_BIN: join(temporary, "no-search"),
        MED_SEARCH_CACHE: join(temporary, "search"),
      },
    },
  );
  const launch = await new Promise((accept, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("Host startup timed out")), 30000);
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited: ${code}`));
    });
    host.stdout.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        accept(match[0]);
      }
    });
  });
  const link = new URL(launch);
  link.pathname = "/file";
  link.search = new URLSearchParams({ repo, path, edit: "1" }).toString();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(link.href);
  const editor = page.getByRole("textbox", { name: `Edit ${path}`, exact: true });
  await editor.waitFor().catch(async (error) => {
    console.error(await page.locator("body").innerText());
    throw error;
  });
  await page.waitForFunction(() => {
    const tokens = [...document.querySelectorAll(".cm-line span[style]")];
    return (
      tokens.length > 20 && new Set(tokens.map((token) => getComputedStyle(token).color)).size > 2
    );
  });
  assert.ok((await editor.textContent()).includes(source.split("\n")[0]));
  // Observe the real Vim cursor after keyboard input. Pause the CSS transition
  // to sample its rendered positions without depending on frame timing.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const motion = async (key, property) => {
    const result = await page.evaluate(
      ({ key, property }) =>
        new Promise((resolve, reject) => {
          const caret = document.querySelector(".cm-vimCursorLayer .cm-fat-cursor");
          const timeout = setTimeout(() => {
            caret.removeEventListener("transitionrun", onTransition);
            reject(new Error(`No ${property} cursor transition for ${key}`));
          }, 3000);
          function onTransition(event) {
            if (event.propertyName !== property) return;
            clearTimeout(timeout);
            caret.removeEventListener("transitionrun", onTransition);
            const animation = caret
              .getAnimations()
              .find((item) => item.transitionProperty === property);
            animation.pause();
            const timing = animation.effect.getTiming();
            const positions = [0, timing.duration / 2, timing.duration].map((time) => {
              animation.currentTime = time;
              return parseFloat(getComputedStyle(caret)[property]);
            });
            animation.finish();
            resolve({ positions, duration: timing.duration, easing: timing.easing });
          }
          caret.addEventListener("transitionrun", onTransition);
          document
            .querySelector(".cm-content")
            .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        }),
      { key, property },
    );
    assert.equal(result.duration, 65);
    assert.equal(result.easing, "ease-out");
    const [start, middle, end] = result.positions;
    const progress = (middle - start) / (end - start);
    assert.ok(progress > 0.5 && progress < 1, JSON.stringify(result));
    return result;
  };
  const cursorMotion = { normal: await motion("w", "left") };
  await page.keyboard.press("v");
  cursorMotion.visual = await motion("j", "top");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("l");
  assert.equal(
    await page
      .locator(".cm-vimCursorLayer .cm-fat-cursor")
      .evaluate((caret) => getComputedStyle(caret).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.type("gg0");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  await page.evaluate(() => {
    window.editorFrames = [];
    document.querySelector(".cm-content").addEventListener("input", () => {
      const start = performance.now();
      requestAnimationFrame(() => window.editorFrames.push(performance.now() - start));
    });
  });
  await page.keyboard.press("i");
  await page.keyboard.type("// med Vim editing test\n", { delay: 15 });
  await page.keyboard.press("Escape");
  await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await page.getByRole("img", { name: "Saved", exact: true }).waitFor();
  assert.equal(await readFile(join(repo, path), "utf8"), "// med Vim editing test\n" + source);
  await page.keyboard.press("u");
  await page.getByRole("img", { name: "Unsaved changes", exact: true }).waitFor();
  await page.keyboard.press("Meta+s");
  await page.getByRole("img", { name: "Saved", exact: true }).waitFor();
  assert.equal(await readFile(join(repo, path), "utf8"), source);
  await page.keyboard.press("G");
  await page.keyboard.press("o");
  await page.keyboard.type("// retained draft");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.getByRole("tab", { name: /http2.ts/ }).click();
  await editor.waitFor();
  assert.ok((await editor.textContent()).includes("retained draft"));
  await writeFile(join(repo, path), source + "\n// agent change\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "changed on disk" }).waitFor();
  assert.ok((await editor.textContent()).includes("retained draft"));
  assert.equal(await readFile(join(repo, path), "utf8"), source + "\n// agent change\n");
  await page.screenshot({ path: join(output, "bun-editor-conflict.png") });
  const frames = await page.evaluate(() => window.editorFrames);
  const complete = new Promise((accept) => cdp.once("Tracing.tracingComplete", accept));
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  let trace = "";
  while (true) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  await writeFile(join(output, "typing.trace.json"), trace);
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("tab", { name: "Changes", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: /http2.ts/ }).count(), 0);
  assert.deepEqual(errors, []);
  const sorted = [...frames].sort((a, b) => a - b);
  const report = {
    file: path,
    bytes: Buffer.byteLength(source),
    browser: browser.version(),
    cursorMotion,
    checks: [
      "65ms ease-out cursor motion in Normal and Visual modes",
      "reduced-motion cursor preference",
      "deep link to second repository",
      "Twinkleplop syntax colors",
      "Vim insert and :w",
      "undo after save",
      "byte-identical restore",
      "retained draft after tab switch",
      "external-write conflict",
      "explicit discard",
    ],
    inputToNextFrame: {
      samples: frames,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      maxMs: sorted.at(-1),
      note: "Diagnostic run with tracing; input-event to next animation-frame callback, not key-to-paint latency or a speed comparison.",
    },
    errors,
  };
  await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 6000));
    await page.screenshot({ path: join(output, "failure.png") });
  }
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const stopped = new Promise((accept) => host.once("exit", accept));
    host.kill();
    await stopped;
  }
  await rm(temporary, { recursive: true, force: true });
}
