import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { themes, useTheme } from "../../themes";
import { ChoiceSelect } from "../Controls";
import { Icon } from "../Icon";
import { screens, type Screen } from "./screens";

const WIDTH = 1440;
const HEIGHT = 900;

function frameUrl(screen: Screen, theme: string) {
  if (screen.prototype)
    return `/screens/prototype/${screen.prototype}?${new URLSearchParams({ theme })}`;
  const query = new URLSearchParams({
    recording: `/screens/${screen.recording}`,
    scene: screen.scene,
    theme,
  });
  return `/demo.html?${query}&still&full`;
}

/**
 * The Screens page: whole windows of Med, each the real app on a recorded,
 * invented project (Trailhead), set up as one screen of the design. Where
 * the Elements page shows the parts, this shows how they meet. It runs in
 * the dev server, which serves the frames' page (demo.html).
 */
export default function ScreensPage() {
  const { active } = useTheme();
  const [theme, setTheme] = useState(active.id);
  const [current, setCurrent] = useState<string>(screens[0]!.id);
  useEffect(() => {
    document.title = "Screens · Med";
  }, []);
  // A frame scrolls the page with the wheel until it is clicked.
  useEffect(() => {
    const scroll = (event: MessageEvent<{ type?: string; wheel?: number }>) => {
      if (event.origin !== location.origin || event.data?.type !== "med-demo") return;
      if (typeof event.data.wheel === "number") scrollBy({ top: event.data.wheel });
    };
    addEventListener("message", scroll);
    return () => removeEventListener("message", scroll);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-56px 0px -60% 0px" },
    );
    for (const screen of screens) {
      const node = document.getElementById(screen.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.bar)}>
        <a
          href="/"
          onClick={(event) => {
            if (!document.referrer.startsWith(`${location.origin}/`)) return;
            event.preventDefault();
            history.back();
          }}
          {...stylex.props(ui.button, styles.back)}
          aria-label="Back to Med"
        >
          <Icon name="arrowLeft" size={14} />
        </a>
        <h1 {...stylex.props(styles.title)}>Screens</h1>
        <span {...stylex.props(styles.grow)} />
        <ChoiceSelect
          label="Theme of the screens"
          icon={<Icon name="theme" size={14} />}
          value={theme}
          choices={themes.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={setTheme}
        />
      </header>
      <div {...stylex.props(styles.body)}>
        <nav aria-label="Screens" {...stylex.props(styles.nav)}>
          {screens.map((screen) => (
            <a
              key={screen.id}
              href={`#${screen.id}`}
              aria-current={current === screen.id ? "location" : undefined}
              {...stylex.props(styles.navLink, current === screen.id && styles.navCurrent)}
            >
              {screen.label}
            </a>
          ))}
          <p {...stylex.props(styles.navNote)}>
            Each screen is Med itself, on an invented project. Click into one to use it; nothing
            leaves the page.
          </p>
        </nav>
        <main {...stylex.props(styles.main)}>
          {screens.map((screen) => (
            <ScreenFrame key={screen.id} screen={screen} theme={theme} />
          ))}
        </main>
      </div>
    </div>
  );
}

function ScreenFrame({ screen, theme }: { screen: Screen; theme: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setScale(node.clientWidth / WIDTH));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const url = frameUrl(screen, theme);
  return (
    <section id={screen.id} aria-labelledby={`${screen.id}-title`} {...stylex.props(styles.screen)}>
      <div {...stylex.props(styles.heading)}>
        <h2 id={`${screen.id}-title`} {...stylex.props(styles.name)}>
          {screen.label}
        </h2>
        <a href={url} target="_blank" rel="noreferrer" {...stylex.props(styles.open)}>
          Open full size
        </a>
      </div>
      <p {...stylex.props(styles.note)}>{screen.note}</p>
      <div ref={box} {...stylex.props(styles.window, styles.height(HEIGHT * scale))}>
        <iframe
          title={screen.label}
          src={url}
          loading="lazy"
          width={WIDTH}
          height={HEIGHT}
          {...stylex.props(styles.frame, styles.scale(scale))}
        />
      </div>
    </section>
  );
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingInline: 8,
    backgroundColor: tokens.panel,
    boxShadow: `0 1px 0 ${tokens.line}`,
  },
  back: { width: 28, paddingInline: 0, color: tokens.muted, textDecoration: "none" },
  title: { margin: 0, marginInlineStart: 4, fontSize: 13, fontWeight: 600 },
  grow: { flex: "1" },
  body: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 900px)": "180px minmax(0, 1fr)",
    },
    gap: 24,
    maxWidth: 1600,
    marginInline: "auto",
    paddingInline: 16,
  },
  nav: {
    display: { default: "none", "@media (min-width: 900px)": "flex" },
    flexDirection: "column",
    gap: 2,
    position: "sticky",
    top: 44,
    alignSelf: "start",
    paddingTop: 28,
  },
  navLink: {
    paddingBlock: 5,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    color: { default: tokens.muted, ":hover": tokens.text },
    fontSize: 12.5,
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  navCurrent: { color: tokens.text, backgroundColor: tokens.fill },
  navNote: {
    marginTop: 16,
    paddingInline: 8,
    color: tokens.faint,
    fontSize: 11,
    lineHeight: 1.5,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: 56,
    minWidth: 0,
    paddingTop: 28,
    paddingBottom: 80,
  },
  screen: { minWidth: 0, scrollMarginTop: 60 },
  heading: { display: "flex", alignItems: "baseline", gap: 12 },
  name: { margin: 0, fontSize: 15, fontWeight: 600 },
  open: {
    color: { default: tokens.muted, ":hover": tokens.text },
    fontSize: 12,
    textDecoration: "none",
  },
  note: {
    maxWidth: 720,
    marginTop: 6,
    marginBottom: 14,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.5,
  },
  window: {
    position: "relative",
    overflow: "hidden",
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}, ${tokens.shadow}`,
    backgroundColor: tokens.canvas,
  },
  height: (height: number) => ({ height }),
  frame: {
    position: "absolute",
    top: 0,
    left: 0,
    borderWidth: 0,
    transformOrigin: "0 0",
  },
  scale: (scale: number) => ({ transform: `scale(${scale})` }),
});
