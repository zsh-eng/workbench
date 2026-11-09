import type { CSSProperties, ReactNode, SVGProps } from "react";
import { pierreIcons } from "./pierre-icons";

// Med's icons are Pierre's, the set that Diffs and Trees draw with (see
// upstream/PIERRE-ICONS.md): filled shapes on a 16-pixel grid, with lines
// 1.5 pixels wide and a lighter second tone. scripts/pierre-icons.ts copies
// them. Where Pierre has no icon, Med draws one below, on the same grid at
// the same weight. Take a new icon from Pierre's set, and name it for what
// it does in Med.
type PierreName = keyof typeof pierreIcons;
type DrawnName =
  | "brief"
  | "claude"
  | "codex"
  | "command"
  | "pullRequest"
  | "testFile"
  | "restore"
  | "focusExit"
  | "play"
  | "pause";
export type IconName = PierreName | DrawnName;

/** Strokes on the 16-pixel grid, as wide as Pierre's lines. */
const drawn: Record<DrawnName, ReactNode> = {
  // Indented lines with a change bar beside one of them: Med's own mark.
  brief: <path d="M6 3.75h7.25M8 8h5.25M6 12.25h4.5M2.75 6.75v2.5" />,
  // Claude's spark: eight rays from the centre.
  claude: (
    <path d="M8 2.25v3.5M8 10.25v3.5M2.25 8h3.5M10.25 8h3.5M3.95 3.95l2.45 2.45M9.6 9.6l2.45 2.45M12.05 3.95 9.6 6.4M6.4 9.6l-2.45 2.45" />
  ),
  // Codex works in a terminal: a prompt in a window.
  codex: (
    <>
      <rect x="2.25" y="3" width="11.5" height="10" rx="2.25" />
      <path d="m5 6.5 1.75 1.5L5 9.5M8.25 10h2.75" />
    </>
  ),
  // The Command key: a square with a loop at each corner.
  command: (
    <path d="M6 6h4v4H6zM6 6V4.25A1.75 1.75 0 1 0 4.25 6H6M10 6V4.25a1.75 1.75 0 1 1 1.75 1.75H10M10 10v1.75A1.75 1.75 0 1 0 11.75 10H10M6 10v1.75A1.75 1.75 0 1 1 4.25 10H6" />
  ),
  // A branch that comes back: two ends on the left, and an arrow into the
  // right one.
  pullRequest: (
    <>
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75v-4.5a1.75 1.75 0 0 0-1.75-1.75H7.5M9.25 2.75 7.5 4.5l1.75 1.75" />
    </>
  ),
  // A flask.
  testFile: (
    <path d="M5.75 1.75h4.5M6.75 1.75v4.5L3.2 12.4a1.25 1.25 0 0 0 1.08 1.85h7.44a1.25 1.25 0 0 0 1.08-1.85L9.25 6.25v-4.5M4.6 10h6.8" />
  ),
  // Pierre's ArrowsExpand, turned inward.
  restore: <path d="M9.75 1.75v4.5h4.5M10.25 5.75l4-4M6.25 14.25v-4.5h-4.5M5.75 10.25l-4 4" />,
  focusExit: <path d="M9.75 1.75v4.5h4.5M10.25 5.75l4-4M6.25 14.25v-4.5h-4.5M5.75 10.25l-4 4" />,
  play: <path d="M4.75 3.25v9.5L12.5 8z" />,
  pause: <path d="M5.5 3.25v9.5M10.5 3.25v9.5" />,
};

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A Pierre icon's shapes, turned when its name faces another way. */
function pierreShapes(name: PierreName) {
  const icon = pierreIcons[name] as (typeof pierreIcons)[PierreName] & { turn?: number };
  const [, , width, height] = icon.box.split(" ").map(Number);
  const transform = icon.turn ? `rotate(${icon.turn} ${width! / 2} ${height! / 2})` : undefined;
  return { icon, transform };
}

/** An icon's shapes, without its <svg>, for a control that draws over it
 * itself, such as Copy comments turning into a check. Pierre's grid. */
export function IconShapes({ name }: { name: PierreName }) {
  const { icon, transform } = pierreShapes(name);
  return (
    <g transform={transform}>
      {icon.shapes.map(([tag, attributes], index) => {
        const Tag = tag as "path";
        return <Tag key={index} {...(attributes as SVGProps<SVGPathElement>)} />;
      })}
    </g>
  );
}

/** Every icon name, for the elements page. */
export const iconNames = [...Object.keys(pierreIcons), ...Object.keys(drawn)] as IconName[];

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  const box = {
    width: size,
    height: size,
    "aria-hidden": true,
    focusable: false,
    style: { flexShrink: 0, ...style },
  } as const;
  if (name in drawn)
    return (
      <svg
        {...box}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {drawn[name as DrawnName]}
      </svg>
    );
  return (
    <svg {...box} viewBox={pierreIcons[name as PierreName].box} fill="currentColor">
      <IconShapes name={name as PierreName} />
    </svg>
  );
}

/** A Pierre icon as markup, for buttons that the page builds outside React. */
export function iconMarkup(name: PierreName, size = 16) {
  const { icon, transform } = pierreShapes(name);
  const shapes = icon.shapes
    .map(
      ([tag, attributes]) =>
        `<${tag} ${Object.entries(attributes)
          .map(([key, value]) => `${kebab(key)}="${value}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="${icon.box}" fill="currentColor" aria-hidden="true" focusable="false"><g${transform ? ` transform="${transform}"` : ""}>${shapes}</g></svg>`;
}
