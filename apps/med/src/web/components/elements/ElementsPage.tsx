import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { themeController, themes, useTheme } from "../../themes";
import { ChoiceSelect, SegmentedControl } from "../Controls";
import { Icon } from "../Icon";
import { ToolButton } from "../ToolButton";
import { NotesSection } from "./NotesSection";
import { PanesSection } from "./PanesSection";
import { CodeSection } from "./CodeSection";
import { CommitSection } from "./CommitSection";
import { ControlsSection } from "./ControlsSection";
import { FoundationsSection } from "./FoundationsSection";
import { Inspector } from "./Inspector";
import { ReviewSection } from "./ReviewSection";
import { SessionSection } from "./SessionSection";
import { StageContext } from "./Specimen";
import "./ElementsPage.css";

const sections = [
  { id: "foundations", label: "Foundations" },
  { id: "controls", label: "Controls" },
  { id: "review", label: "Review parts" },
  { id: "code", label: "Code colors" },
  { id: "notes", label: "Notes" },
  { id: "panes", label: "Side panes" },
  { id: "session", label: "Agent session" },
  { id: "commit", label: "Commit flow" },
] as const;

type Zoom = "1" | "2" | "3";

/**
 * The elements page: Med's real components on fixed sample data, grouped from
 * tokens to whole compositions. The theme switch previews without saving, so
 * a theme can be checked here and left unchanged in the app.
 */
export default function ElementsPage() {
  const { active, saved } = useTheme();
  const [zoom, setZoom] = useState<Zoom>("1");
  const [outlines, setOutlines] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [current, setCurrent] = useState<string>(sections[0].id);
  useEffect(() => {
    document.title = "Elements · Med";
    return () => themeController.cancelPreview();
  }, []);
  // The navigation follows the section at the top of the page.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-56px 0px -70% 0px" },
    );
    for (const section of sections) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <div {...stylex.props(styles.page)} data-outlines={outlines || undefined}>
      <header {...stylex.props(styles.bar)}>
        <a
          href="/"
          onClick={(event) => {
            // Return to the workspace the page was opened from, with its address.
            if (!document.referrer.startsWith(`${location.origin}/`)) return;
            event.preventDefault();
            history.back();
          }}
          {...stylex.props(ui.button, styles.back)}
          aria-label="Back to Med"
        >
          <Icon name="arrowLeft" size={14} />
        </a>
        <h1 {...stylex.props(styles.title)}>Elements</h1>
        <span {...stylex.props(styles.grow)} />
        <ChoiceSelect
          label="Theme"
          icon={<Icon name="theme" size={14} />}
          value={active.id}
          choices={themes.map((theme) => ({ value: theme.id, label: theme.label }))}
          onChange={(id) => themeController.preview(id)}
        />
        {active.id !== saved.id && (
          <button
            type="button"
            {...stylex.props(ui.button, ui.outlined)}
            onClick={() => themeController.commit(active.id)}
          >
            Use in Med
          </button>
        )}
        <span {...stylex.props(styles.divider)} />
        <SegmentedControl<Zoom>
          label="Zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "1", label: "Actual size", icon: "focusExit" },
            { value: "2", label: "Zoom 2×", icon: "search" },
            { value: "3", label: "Zoom 3×", icon: "focus" },
          ]}
        />
        <ToolButton
          icon="selector"
          label="Outline boxes"
          active={outlines}
          aria-pressed={outlines}
          onClick={() => setOutlines((value) => !value)}
        />
        <ToolButton
          icon="preview"
          label="Inspect tokens"
          active={inspect}
          aria-pressed={inspect}
          onClick={() => setInspect((value) => !value)}
        />
      </header>
      <div {...stylex.props(styles.body)}>
        <nav aria-label="Sections" {...stylex.props(styles.nav)}>
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={current === section.id ? "location" : undefined}
              {...stylex.props(styles.navLink, current === section.id && styles.navCurrent)}
            >
              {section.label}
            </a>
          ))}
          <p {...stylex.props(styles.navNote)}>
            Theme changes here are a preview. Leave the page to return to {saved.label}.
          </p>
        </nav>
        <main {...stylex.props(styles.main)}>
          <StageContext.Provider value={{ zoom: Number(zoom) }}>
            <FoundationsSection onPickTheme={(id) => themeController.preview(id)} />
            <ControlsSection />
            <ReviewSection />
            <CodeSection />
            <NotesSection />
            <PanesSection />
            <SessionSection />
            <CommitSection />
          </StageContext.Provider>
        </main>
      </div>
      {inspect && <Inspector themeId={active.id} />}
    </div>
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
  divider: { width: 1, height: 16, marginInline: 4, backgroundColor: tokens.line },
  body: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 900px)": "180px minmax(0, 1fr)",
    },
    gap: 24,
    maxWidth: 1440,
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
  main: { minWidth: 0, paddingTop: 28, paddingBottom: 80 },
});
