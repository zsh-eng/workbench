/**
 * `bun run kit … --before apps/med/scripts/kit/titlebar.ts`: Med as the
 * installed app with its title bar hidden (window controls overlay), as
 * Chrome lays out the window on macOS 26 and later. A test browser cannot
 * install the app, and Chrome's own emulation draws nothing in a screenshot,
 * so the page gets the same geometry by hand:
 *
 * - `navigator.windowControlsOverlay` says the overlay shows, so Med takes
 *   its overlay path (src/web/data/title-bar.ts).
 * - The `env(titlebar-area-*)` fallbacks in Med's CSS take the window's
 *   values, as DevTools' own emulation does (OverlayModel.ts).
 * - Chrome's boxes are drawn over the page: the traffic lights at the left
 *   and the app's menu buttons at the right, in the frame colour.
 *
 * The geometry is Chromium's (chrome/browser/ui/views/frame): the strip is
 * the web app toolbar's 24 px buttons plus 7 px above and below, 38 px;
 * macOS centres the traffic lights in a title bar of that height, in
 * 12, 10, 62 × 18 on macOS 26. `MED_TITLEBAR_HEIGHT` tries another height.
 */
import type { BrowserContext } from "playwright";

const height = Number(process.env.MED_TITLEBAR_HEIGHT ?? 38);
/** The traffic lights' box and the 12 px after it. */
const left = 86;
/** Chrome's buttons at the right: the app menu and the title bar toggle. */
const right = 100;

export default async function titlebar({ context }: { context: BrowserContext }) {
  await context.route(/\/assets\/.*\.css(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const css = (await response.text())
      .replace(/env\(titlebar-area-x(?:,[^)]*)?\)/g, `env(titlebar-area-x, ${left}px)`)
      .replace(/env\(titlebar-area-y(?:,[^)]*)?\)/g, "env(titlebar-area-y, 0px)")
      .replace(/env\(titlebar-area-height(?:,[^)]*)?\)/g, `env(titlebar-area-height, ${height}px)`)
      .replace(
        /env\(titlebar-area-width(?:,[^)]*)?\)/g,
        `env(titlebar-area-width, calc(100vw - ${left + right}px))`,
      );
    await route.fulfill({ response, body: css });
  });
  await context.addInitScript(
    ({ height, left, right }) => {
      const overlay = new EventTarget() as EventTarget & Record<string, unknown>;
      overlay.visible = true;
      overlay.getTitlebarAreaRect = () => new DOMRect(left, 0, innerWidth - left - right, height);
      Object.defineProperty(navigator, "windowControlsOverlay", { value: overlay });
      const draw = () => {
        const frame = document.createElement("div");
        frame.dataset.kitTitlebar = "";
        frame.style.cssText =
          "position:fixed;inset:0 0 auto 0;pointer-events:none;z-index:2147483647";
        const box = (css: string) => {
          const part = document.createElement("div");
          part.style.cssText = `position:absolute;top:0;height:${height}px;background:#111217;${css}`;
          frame.append(part);
          return part;
        };
        const lights = box(`left:0;width:${left}px`);
        ["#ff5f57", "#febc2e", "#28c840"].forEach((color, index) => {
          const light = document.createElement("span");
          light.style.cssText = `position:absolute;left:${12 + 2 + index * 24}px;top:${height / 2 - 7}px;width:14px;height:14px;border-radius:50%;background:${color}`;
          lights.append(light);
        });
        const buttons = box(`right:0;width:${right}px`);
        [right - 7 - 24, right - 7 - 24 - 8 - 24].forEach((x) => {
          const button = document.createElement("span");
          button.style.cssText = `position:absolute;left:${x}px;top:${(height - 24) / 2}px;width:24px;height:24px;border-radius:6px;box-shadow:inset 0 0 0 1.5px #8b8d98`;
          buttons.append(button);
        });
        document.documentElement.append(frame);
      };
      if (document.readyState === "loading") addEventListener("DOMContentLoaded", draw);
      else draw();
    },
    { height, left, right },
  );
}
