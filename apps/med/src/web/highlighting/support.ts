import { useSyncExternalStore } from "react";

/**
 * Whether Pierre's highlighter colours a language. Pierre names more file
 * types than its highlighter knows, and reads the rest as plain text. The
 * check loads the highlighter's module, so it loads once, when first asked.
 */
let supported: ((language: string) => boolean) | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function load() {
  loading ??= import("@pierre/highlights").then(({ isSupportedLanguage }) => {
    supported = isSupportedLanguage;
    for (const listener of listeners) listener();
  });
}

/** True or false once known; undefined while the check loads. */
export function useSyntaxSupport(language: string): boolean | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      load();
      return () => listeners.delete(listener);
    },
    () => (language === "text" ? true : supported?.(language)),
  );
}
