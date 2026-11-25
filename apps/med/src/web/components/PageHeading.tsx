import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { tokens } from "../theme.stylex";

/**
 * The top of a page of its own, such as Sources, Pull requests, or
 * Dashboards: its title, with the page's actions on the title's line, and an
 * optional lead under it. Pages put it in `page.column`, so each starts at
 * the same edge and holds the same width.
 */
export function PageHeading({
  title,
  count,
  lead,
  children,
}: {
  title: string;
  /** Quiet pill beside the title, such as a thread or source count. */
  count?: ReactNode;
  lead?: ReactNode;
  /** The page's actions, at the title line's end. */
  children?: ReactNode;
}) {
  return (
    <>
      <div {...stylex.props(page.heading)}>
        <div {...stylex.props(page.titleGroup)}>
          <h1 {...stylex.props(page.title)}>{title}</h1>
          {count}
        </div>
        {children}
      </div>
      {lead && <p {...stylex.props(page.lead)}>{lead}</p>}
    </>
  );
}

export const page = stylex.create({
  // One column for every page: its title, lead, and lists share one edge.
  column: {
    boxSizing: "content-box",
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: { default: 44, "@media (max-width: 640px)": 16 },
    paddingTop: 56,
    // Room below the end, so the last section scrolls up out of the bottom third.
    paddingBottom: "max(72px, 33vh)",
  },
  heading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
  },
  titleGroup: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    height: 21,
    paddingInline: 8,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  lead: {
    margin: 0,
    marginTop: 8,
    maxWidth: 640,
    color: tokens.muted,
    fontSize: 13.5,
    lineHeight: 1.55,
  },
  // Framed list surface shared by Sources, Archived, and Dashboards.
  card: {
    marginInline: { default: -16, "@media (max-width: 640px)": 0 },
    overflow: "hidden",
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 2.5%, transparent)`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  iconTile: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    height: 20,
    paddingInline: 7,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  emptyCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 10,
    marginTop: 28,
    marginInline: { default: -16, "@media (max-width: 640px)": 0 },
    paddingBlock: 40,
    paddingInline: 24,
    borderRadius: `calc(12px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.lineStrong,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 1.6%, transparent)`,
  },
  emptyTitle: {
    margin: 0,
    color: tokens.text,
    fontSize: 14,
    fontWeight: 550,
    letterSpacing: "-0.01em",
  },
  emptyNote: {
    margin: 0,
    maxWidth: 440,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.55,
  },
  // A list whose rows have their own inset: its text starts at the title's edge.
  flush: { marginInline: -10 },
  // A section of the page: its name, then its count in the secondary color.
  section: { marginTop: 36 },
  sectionTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 550,
    letterSpacing: "-0.005em",
    color: tokens.muted,
  },
  count: { color: tokens.faint, fontSize: 12, fontWeight: 400, fontVariantNumeric: "tabular-nums" },
});
