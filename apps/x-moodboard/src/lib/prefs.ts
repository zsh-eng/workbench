import { useCallback, useState } from "react";

// Per-browser conveniences only. The app works when storage is blocked.
function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(`cuttings:${key}`);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, allowed, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`cuttings:${key}`, next);
      } catch {
        // Storage can be unavailable in private windows.
      }
    },
    [key],
  );
  return [value, update] as const;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range"].includes(type);
  }
  return false;
}
