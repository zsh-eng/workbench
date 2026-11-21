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
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** The page's actions, at the title line's end. */
  children?: ReactNode;
}) {
  return (
    <>
      <div {...stylex.props(page.heading)}>
        <h1 {...stylex.props(page.title)}>{title}</h1>
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
    paddingTop: { default: 56, "@media (max-width: 640px)": 24 },
    // Room below the end, so the last section scrolls up out of the bottom third.
    paddingBottom: "max(72px, 33vh)",
  },
  heading: { display: "flex", alignItems: "center", gap: 8, minHeight: 32 },
  title: {
    flex: "1",
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  lead: {
    margin: 0,
    marginTop: 8,
    maxWidth: 680,
    color: tokens.muted,
    fontSize: 14,
    lineHeight: 1.55,
  },
  // A list whose rows have their own inset: its text starts at the title's edge.
  flush: { marginInline: -10 },
  // A section of the page: its name, then its count in the secondary color.
  section: { marginTop: 44 },
  sectionTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    marginBottom: 14,
    fontSize: 17,
    fontWeight: 550,
    letterSpacing: "-0.012em",
  },
  count: { color: tokens.muted, fontSize: 14, fontWeight: 400 },
});
