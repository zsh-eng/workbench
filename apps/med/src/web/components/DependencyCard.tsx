import * as stylex from "@stylexjs/stylex";
import type { DependencyInfo } from "../../shared/generated";
import {
  versionKey,
  type DependencyChange,
  type DependencySection,
  type ManifestState,
} from "../data/dependencies";
import { relativeTime, useMinuteClock } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

const SECTION_TAGS: Record<DependencySection, string | null> = {
  dependencies: null,
  devDependencies: "dev",
  peerDependencies: "peer",
  optionalDependencies: "optional",
};
/** A release younger than this is marked: a supply-chain risk worth a look. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The dependencies that a comparison's package.json files change, at the top
 * of the stream (docs/GENERATED.md): each package's old and new version, a
 * major bump, and, once the reader turns lookups on, its licence and release
 * date from deps.dev. A lockfile adds one line for the indirect ones.
 */
export function DependencyCard({
  manifests,
  lockfiles,
  info,
  onLookups,
  onReveal,
}: {
  manifests: readonly { id: string; path: string; state: ManifestState }[];
  /** Lockfiles with the indirect packages that they change, in words. */
  lockfiles: readonly { id: string; path: string; summary: string }[];
  /** deps.dev's answers by `versionKey`; null while lookups are off. */
  info: ReadonlyMap<string, DependencyInfo> | null;
  onLookups(on: boolean): void;
  onReveal(id: string): void;
}) {
  const now = useMinuteClock(!!info);
  const lookups = info !== null;
  return (
    <section aria-label="Dependencies" data-dependency-card="" {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.heading)}>
        <span {...stylex.props(ui.label)}>Dependencies</span>
        <span {...stylex.props(ui.grow)} />
        <button
          type="button"
          aria-pressed={lookups}
          title={
            lookups
              ? "Stop looking up licences and release dates"
              : "Sends each package's name and version to deps.dev; the host keeps the answers"
          }
          onClick={() => onLookups(!lookups)}
          {...stylex.props(styles.lookups)}
        >
          <Icon name="globe" size={13} />
          {lookups ? "Licences and dates on" : "Look up licences and dates"}
        </button>
      </div>
      {manifests.map((manifest) => (
        <div key={manifest.id} {...stylex.props(styles.manifest)}>
          <button
            type="button"
            role="link"
            onClick={() => onReveal(manifest.id)}
            {...stylex.props(styles.manifestPath)}
          >
            {manifest.path}
          </button>
          {manifest.state === "loading" ? (
            <p {...stylex.props(styles.note)}>Reading the manifest…</p>
          ) : manifest.state === "unavailable" ? (
            <p {...stylex.props(styles.note)}>The manifest's two sides are not readable.</p>
          ) : manifest.state.length === 0 ? (
            <p {...stylex.props(styles.note)}>No dependency changed.</p>
          ) : (
            <table {...stylex.props(styles.table)}>
              <thead>
                <tr>
                  <th {...stylex.props(styles.th)}>Package</th>
                  <th {...stylex.props(styles.th)}>Version</th>
                  {lookups && <th {...stylex.props(styles.th)}>Licence</th>}
                  {lookups && <th {...stylex.props(styles.th, styles.end)}>Released</th>}
                </tr>
              </thead>
              <tbody>
                {manifest.state.map((change) => (
                  <DependencyRow
                    key={`${change.section}:${change.name}`}
                    change={change}
                    info={info}
                    now={now}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {lockfiles.map((lockfile) => (
        <p key={lockfile.id} {...stylex.props(styles.lockfile)}>
          <button
            type="button"
            role="link"
            onClick={() => onReveal(lockfile.id)}
            {...stylex.props(styles.manifestPath)}
          >
            {lockfile.path}
          </button>
          <span>{lockfile.summary}</span>
        </p>
      ))}
    </section>
  );
}

function DependencyRow({
  change,
  info,
  now,
}: {
  change: DependencyChange;
  info: ReadonlyMap<string, DependencyInfo> | null;
  now: number;
}) {
  const tag = SECTION_TAGS[change.section];
  const next = change.toVersion ? info?.get(versionKey(change.name, change.toVersion)) : undefined;
  const previous = change.fromVersion
    ? info?.get(versionKey(change.name, change.fromVersion))
    : undefined;
  const licenceChanged =
    !!next?.licence && !!previous?.licence && next.licence !== previous.licence;
  const fresh = next?.publishedAt !== undefined && now - next.publishedAt < FRESH_MS;
  const shown = (range: string | undefined, version: string | undefined) => version ?? range;
  return (
    <tr data-dependency={change.name}>
      <td {...stylex.props(styles.td)}>
        <span {...stylex.props(styles.name)}>{change.name}</span>
        {tag && <span {...stylex.props(styles.tag)}>{tag}</span>}
      </td>
      <td {...stylex.props(styles.td, styles.version)}>
        {change.from === undefined ? (
          <>
            {shown(change.to, change.toVersion)}
            <span {...stylex.props(styles.tag, styles.added)}>added</span>
          </>
        ) : change.to === undefined ? (
          <>
            <span {...stylex.props(styles.removedVersion)}>
              {shown(change.from, change.fromVersion)}
            </span>
            <span {...stylex.props(styles.tag, styles.removed)}>removed</span>
          </>
        ) : (
          <>
            <span {...stylex.props(styles.previous)}>{shown(change.from, change.fromVersion)}</span>
            <span {...stylex.props(styles.arrow)}>→</span>
            {shown(change.to, change.toVersion)}
            {change.major && <span {...stylex.props(styles.tag, styles.major)}>major</span>}
          </>
        )}
        {!!next?.advisories && (
          <span
            {...stylex.props(styles.tag, styles.removed)}
            title="Security advisories on deps.dev"
          >
            {next.advisories} {next.advisories === 1 ? "advisory" : "advisories"}
          </span>
        )}
        {next?.deprecated && <span {...stylex.props(styles.tag, styles.major)}>deprecated</span>}
      </td>
      {info && (
        <td {...stylex.props(styles.td, licenceChanged && styles.warn)}>
          {licenceChanged ? `${previous!.licence} → ${next!.licence}` : (next?.licence ?? "—")}
        </td>
      )}
      {info && (
        <td
          {...stylex.props(styles.td, styles.end, fresh && styles.warn)}
          title={
            next?.publishedAt !== undefined
              ? new Date(next.publishedAt).toLocaleString()
              : next?.unknown
                ? "deps.dev does not know this version"
                : undefined
          }
        >
          {next?.publishedAt !== undefined ? relativeTime(next.publishedAt, now) : "—"}
        </td>
      )}
    </tr>
  );
}

const styles = stylex.create({
  card: {
    marginBlock: 12,
    marginInline: 12,
    paddingBlock: 10,
    paddingInline: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    color: tokens.text,
  },
  heading: { display: "flex", alignItems: "center", gap: 8, minHeight: 24 },
  lookups: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  manifest: { marginTop: 8 },
  manifestPath: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
    cursor: "pointer",
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
  },
  note: { marginBlock: 4, color: tokens.faint, fontSize: 12 },
  table: { width: "100%", marginTop: 4, borderCollapse: "collapse" },
  th: {
    paddingBlock: 4,
    paddingInlineEnd: 16,
    textAlign: "left",
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 450,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  td: {
    paddingBlock: 5,
    paddingInlineEnd: 16,
    whiteSpace: "nowrap",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  end: { textAlign: "right", paddingInlineEnd: 0 },
  name: { fontWeight: 550 },
  version: { fontFamily: tokens.code, fontSize: 11.5 },
  previous: { color: tokens.faint },
  removedVersion: { color: tokens.faint, textDecoration: "line-through" },
  arrow: { marginInline: 6, color: tokens.faint },
  tag: {
    marginInlineStart: 6,
    paddingInline: 5,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: "16px",
  },
  added: {
    color: tokens.green,
    backgroundColor: `color-mix(in srgb, ${tokens.green} 13%, transparent)`,
  },
  removed: {
    color: tokens.red,
    backgroundColor: `color-mix(in srgb, ${tokens.red} 13%, transparent)`,
  },
  major: {
    color: tokens.warning,
    backgroundColor: `color-mix(in srgb, ${tokens.warning} 14%, transparent)`,
  },
  warn: { color: tokens.warning },
  lockfile: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "baseline",
    marginTop: 8,
    marginBottom: 0,
    color: tokens.muted,
  },
});
