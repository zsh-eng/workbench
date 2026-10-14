// A stage for Med's exploration scenes: the built host on the demo world, a
// browser with a caption bar and a drawn pointer, and, when recording, a 2x
// screencast that becomes an MP4. Headless runs take screenshots instead.
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const cli = resolve(import.meta.dirname, "../../dist/cli.js");

/** The overlay: a caption bar, a title card, and a pointer. Pages call
 * `window.__stage` to change them; none of it takes pointer events. */
function overlay() {
  if (window.__stage) return;
  const css = `
    #xp-root { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: Geist, ui-sans-serif, system-ui, sans-serif; }
    #xp-caption { position: absolute; left: 50%; bottom: 34px; transform: translate(-50%, 8px); max-width: min(880px, calc(100% - 64px)); padding: 11px 18px 12px; border-radius: 12px; background: rgba(18, 19, 24, 0.9); color: #ecebe8; font-size: 16px; line-height: 1.5; letter-spacing: -0.005em; box-shadow: 0 10px 40px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08); opacity: 0; transition: opacity 220ms ease, transform 220ms ease, bottom 220ms ease; text-wrap: pretty; }
    #xp-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #xp-caption b { font-weight: 600; color: #fff; }
    #xp-caption kbd { font-family: "Paper Mono", ui-monospace, monospace; font-size: 13px; padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,0.12); }
    #xp-card { position: absolute; inset: 0; display: grid; place-items: center; background: #121318; opacity: 0; transition: opacity 360ms ease; }
    #xp-card.on { opacity: 1; }
    #xp-card > div { width: min(760px, calc(100% - 96px)); }
    #xp-card small { display: block; margin-bottom: 18px; color: #8cc3cb; font: 500 13px/1 "Paper Mono", ui-monospace, monospace; letter-spacing: 0.04em; text-transform: uppercase; }
    #xp-card h1 { margin: 0 0 14px; color: #ecebe8; font-size: 40px; font-weight: 500; line-height: 1.15; letter-spacing: -0.02em; }
    #xp-card p { margin: 0; color: #a9a8a3; font-size: 19px; line-height: 1.5; text-wrap: pretty; }
    #xp-card ul { margin: 26px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; counter-reset: item; }
    #xp-card ul:empty { display: none; }
    #xp-card li { counter-increment: item; display: grid; grid-template-columns: 34px 1fr; color: #d6d4cf; font-size: 17px; line-height: 1.45; text-wrap: pretty; }
    #xp-card li::before { content: counter(item, decimal-leading-zero); color: #8cc3cb; font: 500 13px/1.9 "Paper Mono", ui-monospace, monospace; }
    #xp-pointer { position: absolute; left: 0; top: 0; width: 22px; height: 22px; transform: translate(-100px, -100px); transition: transform 0ms; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }
    #xp-pointer.down { scale: 0.88; }
    #xp-card.on ~ #xp-pointer { opacity: 0; }
  `;
  const install = () => {
    if (document.getElementById("xp-root")) return;
    const root = document.createElement("div");
    root.id = "xp-root";
    root.innerHTML = `<style>${css}</style><div id="xp-card"><div><small></small><h1></h1><p></p><ul></ul></div></div><div id="xp-caption"></div><svg id="xp-pointer" viewBox="0 0 22 22"><path d="M4 2.5v15.2l4-3.7 2.6 6 2.7-1.2-2.6-5.9h5.6z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    document.documentElement.append(root);
  };
  const el = (id) => (install(), document.getElementById(id));
  window.__stage = {
    caption(html) {
      const node = el("xp-caption");
      if (!html) return node.classList.remove("on");
      node.innerHTML = html;
      node.classList.add("on");
    },
    card(label, heading, text, items) {
      const node = el("xp-card");
      if (!heading) return node.classList.remove("on");
      node.querySelector("small").textContent = label ?? "";
      node.querySelector("h1").textContent = heading;
      node.querySelector("p").textContent = text ?? "";
      node
        .querySelector("ul")
        .replaceChildren(
          ...(items ?? []).map((item) =>
            Object.assign(document.createElement("li"), { textContent: item }),
          ),
        );
      node.classList.add("on");
    },
    pointer(x, y, down) {
      const node = el("xp-pointer");
      node.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
      node.classList.toggle("down", !!down);
    },
  };
  document.addEventListener("DOMContentLoaded", install);
  // The caption rises above Med's own toasts near the bottom of the window:
  // fixed elements, and notices that float over a page.
  const floats = (node) => {
    const position = getComputedStyle(node).position;
    return (
      position === "fixed" ||
      (position === "absolute" && node.matches('[role="status"], [role="alert"]'))
    );
  };
  const toastAt = (element) => {
    for (let node = element, depth = 0; node && depth < 6; node = node.parentElement, depth++)
      if (floats(node)) return node;
    return null;
  };
  const small = (box) => box.height > 0 && box.height < 140 && box.width < innerWidth * 0.7;
  setInterval(() => {
    const caption = document.getElementById("xp-caption");
    if (!caption?.classList.contains("on")) return;
    let top = innerHeight;
    for (let y = innerHeight - 16; y > innerHeight - 180; y -= 12)
      for (const x of [innerWidth * 0.3, innerWidth * 0.5, innerWidth * 0.7])
        for (const element of document.elementsFromPoint(x, y)) {
          if (element.closest("#xp-root")) continue;
          const box = toastAt(element)?.getBoundingClientRect();
          if (box && small(box)) top = Math.min(top, box.top);
        }
    // A narrow notice can sit between the points above.
    for (const notice of document.querySelectorAll('[role="status"], [role="alert"]')) {
      if (notice.closest("#xp-root") || !floats(notice)) continue;
      if (!notice.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const box = notice.getBoundingClientRect();
      if (small(box) && box.bottom > innerHeight - 180) top = Math.min(top, box.top);
    }
    caption.style.bottom = `${Math.max(34, innerHeight - top + 14)}px`;
  }, 200);
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Starts the host on the world and opens the stage. `record` writes frames
 * for a video into `out`; otherwise `shot()` writes screenshots there.
 */
export async function openStage({
  world,
  port,
  out,
  record = false,
  width = 1440,
  height = 900,
  theme,
}) {
  await mkdir(out, { recursive: true });
  const env = { ...process.env, ...world.env, CLAUDE_CODE_SESSION_ID: "" };
  delete env.CLAUDE_CODE_SESSION_ID;
  const run = (args, extra = {}) =>
    execFileSync("node", [cli, ...args, "--state-dir", world.state, "--port", String(port)], {
      encoding: "utf8",
      env: { ...env, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
  const host = spawn("node", [cli, "serve", "--state-dir", world.state, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostLog = "";
  host.stdout.on("data", (chunk) => (hostLog += chunk));
  host.stderr.on("data", (chunk) => (hostLog += chunk));
  for (let i = 0; ; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      if (i > 100) throw new Error(`The host did not start:\n${hostLog}`);
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  world.register(run);
  const launch = /https?:\/\/\S+/.exec(run(["web", "--no-open"]))[0];

  const browser = await chromium.launch({
    headless: !record,
    args: record ? ["--window-position=0,0"] : [],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme === "light" ? "light" : "dark",
  });
  await context.addInitScript(overlay);
  // Med keeps its own theme; --light starts it on Med Dawn, dark on Med Night.
  await context.addInitScript(
    (id) => {
      try {
        if (!localStorage.getItem("med:theme:v1")) localStorage.setItem("med:theme:v1", id);
      } catch {
        /* The default theme shows. */
      }
    },
    theme === "light" ? "med-dawn" : "med-night",
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Recording: a CDP screencast at device pixels, one JPEG per frame.
  const frames = [];
  let cdp;
  if (record) {
    await rm(join(out, "frames"), { recursive: true, force: true });
    await mkdir(join(out, "frames"));
    cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      const file = join(out, "frames", `${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, at: metadata.timestamp });
      await writeFile(file, Buffer.from(data, "base64"));
      await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
  }

  await page.goto(launch);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (cdp)
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

  let cards = 0;
  let x = width / 2;
  let y = height / 2;
  const call = (method, ...args) =>
    page.evaluate(([m, a]) => window.__stage?.[m](...a), [method, args]);
  const stage = {
    page,
    world,
    errors,
    cli: run,
    wait: (ms) => page.waitForTimeout(ms),
    /** Shows a caption; HTML allows <b> and <kbd>. */
    async say(html, ms = 0) {
      await call("caption", html);
      if (ms) await page.waitForTimeout(ms);
    },
    clear: () => call("caption", ""),
    /** A full-window title card; `items` adds a numbered list under the text. */
    async card(label, heading, text, ms = 3200, items) {
      await call("caption", "");
      await call("card", label, heading, text, items);
      if (!record) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(out, `card-${String(++cards).padStart(2, "0")}.png`) });
      }
      await page.waitForTimeout(ms);
      await call("card");
      await page.waitForTimeout(400);
    },
    /** Moves the drawn pointer and the mouse to a point, eased. */
    async moveTo(tx, ty, ms = 650) {
      const steps = Math.max(8, Math.round(ms / 16));
      const [fx, fy] = [x, y];
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        x = fx + (tx - fx) * t;
        y = fy + (ty - fy) * t;
        await page.mouse.move(x, y);
        await call("pointer", x, y, false);
        await page.waitForTimeout(ms / steps);
      }
    },
    /** Moves to the middle of a locator (or a point in it). */
    async point(locator, { dx = 0.5, dy = 0.5, ms } = {}) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      const box = await locator.boundingBox();
      if (!box) throw new Error(`Nothing to point at: ${locator}`);
      await stage.moveTo(box.x + box.width * dx, box.y + box.height * dy, ms);
    },
    async click(locator, options) {
      await stage.point(locator, options);
      await call("pointer", x, y, true);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await call("pointer", x, y, false);
      await page.waitForTimeout(250);
    },
    /** Types like a person: a short pause between keys. */
    async type(text, delay = 45) {
      await page.keyboard.type(text, { delay });
    },
    async key(combo, ms = 350) {
      await page.keyboard.press(combo);
      await page.waitForTimeout(ms);
    },
    async shot(name) {
      if (!record) await page.screenshot({ path: join(out, `${name}.png`) });
    },
    /** Stops the recording (writing out/video.mp4), the browser, and the host. */
    async close() {
      // A static page sends no frames: the last one lasts until the end.
      const end = Date.now() / 1000;
      if (cdp) {
        await cdp.send("Page.stopScreencast").catch(() => {});
        await page.waitForTimeout(300);
      }
      await browser.close();
      host.kill("SIGTERM");
      if (record && frames.length > 1) {
        const lines = [];
        for (let i = 0; i < frames.length; i++) {
          const next = frames[i + 1]?.at ?? Math.max(end, frames[i].at + 1 / 30);
          lines.push(
            `file '${frames[i].file}'`,
            `duration ${Math.max(0.001, next - frames[i].at).toFixed(4)}`,
          );
        }
        lines.push(`file '${frames.at(-1).file}'`);
        await writeFile(join(out, "frames.txt"), lines.join("\n"));
        execFileSync("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          join(out, "frames.txt"),
          "-vf",
          "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-preset",
          "slow",
          join(out, "video.mp4"),
        ]);
      }
      return { frames: frames.length, errors, hostLog };
    },
  };
  return stage;
}

export async function listScenes(dir) {
  return (await readdir(dir)).filter((name) => /^\d\d-.*\.mjs$/.test(name)).sort();
}
