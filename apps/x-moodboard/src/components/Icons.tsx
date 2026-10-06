// Small line icons drawn for this app: 1.5 px strokes on a 20 px grid.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The Cuttings mark: a sheet with its corner clipped away. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      <path d="M3 3h10.5L19 8.5V19H3z" fill="var(--mark-fill)" />
      <path d="M15 2.2l4.8 4.8H15z" fill="var(--accent)" />
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="5.25" />
    <path d="M12.75 12.75 17 17" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);

export const ChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </Icon>
);

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4.5 13.5 10 8 15.5" />
  </Icon>
);

export const ArrowOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.75h8.25V13M15 5 5 15" />
  </Icon>
);

export const Heart = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M10 16.25s-6.25-3.6-6.25-8.1A3.4 3.4 0 0 1 10 6.2a3.4 3.4 0 0 1 6.25 1.95c0 4.5-6.25 8.1-6.25 8.1z" />
  </Icon>
);

export const Play = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <path d="M6.5 4.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L7.4 4.1a.6.6 0 0 0-.9.5z" />
  </Icon>
);

export const Stack = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.75" y="6.25" width="10" height="10" rx="1.5" />
    <path d="M6.75 3.75h8a1.5 1.5 0 0 1 1.5 1.5v8" />
  </Icon>
);

export const Filters = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6h13M6 10h8M8.5 14h3" />
  </Icon>
);

export const GridLoose = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="5.5" height="7" rx="1" />
    <rect x="11" y="3.5" width="5.5" height="4.5" rx="1" />
    <rect x="3.5" y="12.5" width="5.5" height="4" rx="1" />
    <rect x="11" y="10" width="5.5" height="6.5" rx="1" />
  </Icon>
);

export const GridDense = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 3.5h3.5v5H3.5zM8.25 3.5h3.5v3H8.25zM13 3.5h3.5v6H13zM3.5 10h3.5v6.5H3.5zM8.25 8h3.5v8.5H8.25zM13 11h3.5v5.5H13z" />
  </Icon>
);

export const Sun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M4.9 15.1l1.05-1.05M14.05 5.95l1.05-1.05" />
  </Icon>
);

export const Moon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.75 12.4A6.25 6.25 0 0 1 7.6 4.25a6.25 6.25 0 1 0 8.15 8.15z" />
  </Icon>
);

export const Contrast = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.25" />
    <path d="M10 3.75v12.5a6.25 6.25 0 0 0 0-12.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const Expand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
  </Icon>
);

export const Shrink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4" />
  </Icon>
);

export const Link = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 11.5a3 3 0 0 0 4.25 0l2.5-2.5a3 3 0 0 0-4.25-4.25l-.75.75M11.5 8.5a3 3 0 0 0-4.25 0l-2.5 2.5a3 3 0 0 0 4.25 4.25l.75-.75" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5 8 14l7.5-8" />
  </Icon>
);

export const Keyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="5.25" width="14.5" height="9.5" rx="1.5" />
    <path d="M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h.01M6.5 11.75h7" />
  </Icon>
);
