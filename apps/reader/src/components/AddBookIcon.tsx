import type { SVGProps } from "react";

/**
 * Add books: an open book with a plus above it, drawn on Lucide's 24 px grid
 * so it sits with the bar's other icons. Size it with a class, as a Lucide
 * icon.
 */
export function AddBookIcon({
  strokeWidth = 1.6,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 11v10" />
      <path d="M3 19.5V10c2.6-.6 6.2-.3 9 1.2 2.8-1.5 6.4-1.8 9-1.2v9.5c-2.6-.6-6.2-.3-9 1.5-2.8-1.8-6.4-2.1-9-1.5Z" />
      <path d="M12 2v5.5" />
      <path d="M9.25 4.75h5.5" />
    </svg>
  );
}
