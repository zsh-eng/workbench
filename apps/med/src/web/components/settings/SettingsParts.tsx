import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { tokens } from "../../theme.stylex";

// The parts of a Settings page: a section, its rows, and a switch.

/** A part of the page that ⌘K and Display's All code settings can open. */
export type SettingsSection = "appearance" | "code" | "open-in" | "files" | "sources" | "file";

export function Section({
  id,
  title,
  note,
  grouped = false,
  children,
}: {
  id?: SettingsSection;
  title: string;
  note?: string;
  /** Its children are Groups, each a card of its own under a small heading. */
  grouped?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} data-section={id} {...stylex.props(settingStyles.section)}>
      <div {...stylex.props(settingStyles.sectionHead)}>
        <h2 {...stylex.props(settingStyles.sectionTitle)}>{title}</h2>
        {note && <p {...stylex.props(settingStyles.sectionNote)}>{note}</p>}
      </div>
      {grouped ? children : <div {...stylex.props(settingStyles.rows)}>{children}</div>}
    </section>
  );
}

/** A section's group of rows: its heading above, then its own card. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} {...stylex.props(settingStyles.group)}>
      <h3 {...stylex.props(settingStyles.groupTitle)}>{title}</h3>
      <div {...stylex.props(settingStyles.rows)}>{children}</div>
    </div>
  );
}

export /** A setting: its label and note, and its control beside them, or under
 * them (`block`) when the control is wide. */
function Row({
  label,
  note,
  block = false,
  children,
}: {
  label: string;
  note?: string;
  block?: boolean;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(settingStyles.row, block && settingStyles.rowBlock)}>
      <div {...stylex.props(settingStyles.rowText)}>
        <div {...stylex.props(settingStyles.rowLabel)}>{label}</div>
        {note && <div {...stylex.props(settingStyles.rowNote)}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

export function Switch({ label, on, toggle }: { label: string; on: boolean; toggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={toggle}
      {...stylex.props(settingStyles.switch, on && settingStyles.switchOn)}
    >
      <span {...stylex.props(settingStyles.knob, on && settingStyles.knobOn)} />
    </button>
  );
}

export const settingStyles = stylex.create({
  section: { marginTop: 44 },
  sectionHead: { marginBottom: 14 },
  sectionTitle: { margin: 0, fontSize: 17, fontWeight: 550, letterSpacing: "-0.012em" },
  sectionNote: { margin: 0, marginTop: 4, color: tokens.muted, fontSize: 14 },
  group: { marginBottom: { default: 24, ":last-child": 0 } },
  groupTitle: { margin: 0, marginBottom: 8, color: tokens.muted, fontSize: 13, fontWeight: 500 },
  rows: {
    marginInline: -20,
    paddingInline: 20,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
    boxSizing: "border-box",
    minHeight: 64,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  rowBlock: { flexDirection: "column", alignItems: "stretch", gap: 14, paddingBlock: 16 },
  rowText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  rowLabel: { fontSize: 14, fontWeight: 500 },
  rowNote: { color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 30,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: tokens.fill, ":hover": tokens.fillStrong },
    color: tokens.text,
    font: "inherit",
    fontSize: 13,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  // A select's trigger: a quiet bordered button that ends at the text's edge.
  select: {
    flexShrink: 0,
    height: 32,
    paddingInlineStart: 12,
    paddingInlineEnd: 8,
    gap: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: { default: tokens.canvas, ":hover": tokens.hover },
    fontSize: 13,
  },
  switch: {
    position: "relative",
    flexShrink: 0,
    width: 34,
    height: 20,
    padding: 0,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: tokens.lineStrong,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
  },
  switchOn: { backgroundColor: tokens.accent },
  knob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    boxShadow: "0 1px 2px #0003",
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  knobOn: { transform: "translateX(14px)" },
});
