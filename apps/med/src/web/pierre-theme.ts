import { registerCustomTheme, resolveTheme, setCustomExtension } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect } from "react";
import { themes, useTheme, type Theme } from "./themes";
import { zedSyntax } from "./zed-syntax";

/** Pierre's WebAssembly highlighter, `@pierre/highlights`: every view and
 * worker uses it, so code reads the same in a diff, a file, and Markdown. */
export const HIGHLIGHTER = "highlights" as const;

/**
 * Med's themes as Zed themes, the format of Pierre's highlighter. A theme
 * whose syntax Pierre bundles keeps that palette as Pierre builds it; one
 * written for Med maps its TextMate rules to the highlighter's captures. Both
 * take Med's canvas and Git colors, so code sits on the shell's surface.
 */
async function zedTheme(theme: Theme) {
  const base =
    typeof theme.syntax === "string"
      ? (await resolveTheme(theme.syntax, HIGHLIGHTER)).zed!
      : undefined;
  const style = base?.style ?? {};
  const { canvas, green, red, accent } = theme.palette;
  return {
    name: theme.pierreTheme,
    appearance: theme.appearance,
    style: {
      ...style,
      background: canvas,
      "editor.background": canvas,
      "editor.foreground":
        typeof theme.syntax === "string"
          ? (style["editor.foreground"] ?? style.text ?? theme.palette.text)
          : theme.syntax.foreground,
      created: green,
      deleted: red,
      modified: accent,
      "terminal.ansi.green": green,
      "terminal.ansi.red": red,
      "terminal.ansi.blue": accent,
      syntax: typeof theme.syntax === "string" ? style.syntax : zedSyntax(theme.syntax),
    },
  };
}

// Registered themes cross Pierre's shadow boundary and are sent to its
// workers. Load definitions only when requested.
for (const theme of themes)
  registerCustomTheme(theme.pierreTheme, () => zedTheme(theme) as never, "zed");

// Gradle build scripts are Groovy, which Pierre's highlighter knows, but
// Pierre's file types do not name them.
setCustomExtension("gradle", "groovy");

/** Resolves a Med theme for Med's own workers (Markdown, the file editor):
 * a worker cannot load one, so it receives the theme whole. */
export const resolveSyntaxTheme = (name: string) => resolveTheme(name, HIGHLIGHTER);

/** Keep the existing pool and its renderers in sync with live theme previews. */
export function PierreThemeSync() {
  const pool = useWorkerPool();
  const { active } = useTheme();
  useEffect(() => {
    // With workers enabled, Pierre uses pool render options instead of each
    // CodeView's theme. The provider reads its own options only on creation.
    // This API also clears stale syntax caches and rejects older async updates.
    void pool?.setRenderOptions({ theme: active.pierreTheme }).catch((error: unknown) => {
      console.error("Could not apply the syntax theme", error);
    });
  }, [pool, active.pierreTheme]);
  return null;
}
