import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Removes links from markdown
 * @param markdown
 * @returns
 */
export function excludeLinksFromMarkdown(markdown: string) {
  return markdown.replace(/!\[.*?\]\((.*?)\)/g, "");
}

export function debounce(func: () => void, delay: number = 300) {
  let timeout: NodeJS.Timeout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (...args: any[]) {
    clearTimeout(timeout);
    // @ts-expect-error basic debounce implementation
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

export function isEventTargetInput(e: KeyboardEvent) {
  return (
    ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName) ||
    (e.target as HTMLElement)?.isContentEditable
  );
}

export async function delayAfter<T>(
  promise: Promise<T>,
  delay: number,
): Promise<T> {
  const result = await promise;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return result;
}

export const MAX_DATE = new Date(9999, 11, 31);
export function isCardPermanentlySuspended(suspended: Date) {
  return suspended.getTime() >= MAX_DATE.getTime();
}
