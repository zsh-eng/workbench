import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

interface BuildStatus {
  /** The server runs older code than the build on disk. */
  stale: boolean;
  /** Entry script of the page build on disk. */
  entry: string | null;
  /** The server can replace itself. */
  restart: boolean;
}
type Notice =
  | { kind: "restart"; canRestart: boolean }
  | { kind: "reload" }
  | { kind: "restarting" }
  | { kind: "failed"; message: string };

/** A production page names its hashed entry script; the Vite dev page does not. */
const pageEntry = () =>
  document
    .querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/"]')
    ?.getAttribute("src") ?? null;

async function readBuild(): Promise<BuildStatus | null> {
  try {
    const response = await fetch("/api/build", { cache: "no-store" });
    return response.ok ? ((await response.json()) as BuildStatus) : null;
  } catch {
    return null;
  }
}

/** Asks the managed server to replace itself, then reloads once the new one
 * answers. The old server answers until it closes; the new one is current. */
async function restartServer() {
  const response = await fetch("/api/service/restart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(data?.error?.message ?? "Med could not restart.");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 400));
    const build = await readBuild();
    if (build && !build.stale) {
      location.reload();
      return;
    }
  }
  throw new Error("Med did not come back. Run med web in a terminal.");
}

/** Notices a rebuild of Med. A server that runs older code offers Restart; a
 * page older than the build on disk offers Reload. */
export function UpdateNotice({ interval = 60_000 }: { interval?: number }) {
  const [entry] = useState(pageEntry);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const restarting = useRef(false);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    const check = async () => {
      if (restarting.current || document.visibilityState !== "visible") return;
      const build = await readBuild();
      if (cancelled || !build || restarting.current) return;
      const next: Notice | null = build.stale
        ? { kind: "restart", canRestart: build.restart }
        : build.entry && build.entry !== entry
          ? { kind: "reload" }
          : null;
      setKey(`${build.stale}:${build.entry}`);
      // A failed restart stays visible until the user retries or the build is current.
      setNotice((current) =>
        next?.kind === "restart" && current?.kind === "failed" ? current : next,
      );
    };
    void check();
    const timer = window.setInterval(check, interval);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [entry, interval]);

  const restart = () => {
    restarting.current = true;
    setNotice({ kind: "restarting" });
    restartServer().catch((error: unknown) => {
      restarting.current = false;
      setNotice({
        kind: "failed",
        message: error instanceof Error ? error.message : "Med could not restart.",
      });
    });
  };

  if (!notice || (dismissed === key && notice.kind !== "restarting")) return null;
  const text =
    notice.kind === "restarting"
      ? "Restarting Med…"
      : notice.kind === "failed"
        ? notice.message
        : notice.kind === "reload"
          ? "Med was updated."
          : notice.canRestart
            ? "Med was rebuilt."
            : "Med was rebuilt. Restart its server to use it.";
  const action =
    notice.kind === "reload"
      ? "Reload"
      : notice.kind === "failed"
        ? "Try again"
        : notice.kind === "restart" && notice.canRestart
          ? "Restart"
          : null;
  return (
    <div role="status" aria-label="Med update" {...stylex.props(styles.notice)}>
      <span
        aria-hidden="true"
        {...stylex.props(
          styles.dot,
          notice.kind === "failed" && styles.dotFailed,
          notice.kind === "restarting" && styles.dotBusy,
        )}
      />
      <span {...stylex.props(styles.text)}>{text}</span>
      {action && (
        <button
          {...stylex.props(ui.button, ui.primary, ui.pressable, styles.action)}
          onClick={() => (action === "Reload" ? location.reload() : restart())}
        >
          {action}
        </button>
      )}
      {notice.kind !== "restarting" && (
        <button
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => setDismissed(key)}
          {...stylex.props(styles.dismiss)}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "none" },
});
const pulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
const styles = stylex.create({
  // Low on the right, clear of the review's own messages at the bottom centre.
  notice: {
    position: "fixed",
    right: 16,
    bottom: 40,
    zIndex: 90,
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: "min(420px, calc(100vw - 32px))",
    minHeight: 40,
    boxSizing: "border-box",
    paddingBlock: 6,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    borderRadius: 11,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 14px 36px -16px rgb(0 0 0 / 0.55)`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    animationName: { default: rise, [reduced]: "none" },
    animationDuration: "240ms",
    animationTimingFunction: tokens.easeOut,
  },
  dot: {
    flexShrink: 0,
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  dotFailed: { backgroundColor: tokens.warning },
  dotBusy: {
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  text: { flex: "1", minWidth: 0, lineHeight: 1.45 },
  action: { flexShrink: 0, height: 28, paddingInline: 12, fontSize: 12 },
  dismiss: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 24,
    height: 24,
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
});
