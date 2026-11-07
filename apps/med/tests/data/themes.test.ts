import { describe, expect, test, vi } from "vitest";
import { resolveTheme } from "@pierre/diffs";
import "../../src/web/pierre-theme";
import { zedSyntax } from "../../src/web/zed-syntax";
import {
  createThemeController,
  defaultTheme,
  findTheme,
  themes,
  THEME_PAINT_KEY,
  THEME_STORAGE_KEY,
  type SyntaxTheme,
} from "../../src/web/themes";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn<(key: string, value: string) => void>((key, value) => {
      values.set(key, value);
    }),
  };
}

describe("theme choices", () => {
  test("migrates the old light choice and rejects unknown saved names", () => {
    const legacy = createThemeController({ storage: memoryStorage({ "med:theme": "light" }) });
    legacy.initialize();
    expect(legacy.getSnapshot().active.id).toBe("graphite-light");
    const unknown = createThemeController({
      storage: memoryStorage({ [THEME_STORAGE_KEY]: "removed" }),
    });
    unknown.initialize();
    expect(unknown.getSnapshot().active).toBe(defaultTheme);
  });

  test("shows the light or the dark theme, or follows the system between them", () => {
    let dark = true;
    let change = () => {};
    const system = {
      dark: () => dark,
      watch: (listener: () => void) => {
        change = listener;
      },
    };
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "graphite-dark" });
    const controller = createThemeController({ storage, system });
    controller.initialize();
    // One saved theme keeps showing: its appearance is the mode.
    expect(controller.getSnapshot()).toMatchObject({
      mode: "dark",
      active: { id: "graphite-dark" },
      light: { id: "graphite-light" },
    });
    controller.setMode("system");
    expect(controller.getSnapshot().active.id).toBe("graphite-dark");
    dark = false;
    change();
    expect(controller.getSnapshot().active.id).toBe("graphite-light");
    // The light theme for a light system shows at once.
    controller.setTheme("vitesse-light");
    expect(controller.getSnapshot().active.id).toBe("vitesse-light");
    // The picker's dark theme, while the system is light, leaves System for Dark.
    controller.commit("tokyo-night");
    expect(controller.getSnapshot()).toMatchObject({
      mode: "dark",
      active: { id: "tokyo-night" },
      light: { id: "vitesse-light" },
    });
    // index.html paints the frame from this before the app loads.
    expect(JSON.parse(storage.getItem(THEME_PAINT_KEY)!)).toEqual({
      mode: "dark",
      light: findTheme("vitesse-light").palette.panel,
      dark: findTheme("tokyo-night").palette.panel,
    });
    // The choices come back with Med.
    const again = createThemeController({ storage, system });
    again.initialize();
    expect(again.getSnapshot()).toMatchObject({
      mode: "dark",
      active: { id: "tokyo-night" },
      light: { id: "vitesse-light" },
    });
  });

  test("keeps the session usable when browser storage fails", () => {
    const controller = createThemeController({
      storage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
      },
    });
    controller.initialize();
    controller.commit("tokyo-night");
    expect(controller.getSnapshot().saved.id).toBe("tokyo-night");
    expect(controller.getSnapshot().persistenceError).toContain("could not be saved");
    controller.preview("vitesse-light");
    controller.cancelPreview();
    expect(controller.getSnapshot().active.id).toBe("tokyo-night");
  });

  test.each(themes.map((theme) => [theme.pierreTheme, theme] as const))(
    "resolves %s as a Zed theme on Med's canvas, with Med's Git colors",
    async (name, theme) => {
      const resolved = await resolveTheme(name, "highlights");
      expect(resolved.name).toBe(name);
      expect(resolved.type).toBe(theme.appearance);
      expect(resolved.bg).toBe(theme.palette.canvas);
      expect(resolved.colors?.["gitDecoration.addedResourceForeground"]).toBe(theme.palette.green);
      expect(resolved.colors?.["gitDecoration.deletedResourceForeground"]).toBe(theme.palette.red);
    },
  );

  // A bundled syntax keeps Pierre's own build of it.
  test.each(
    themes.flatMap((theme) =>
      typeof theme.syntax === "string" ? [[theme.pierreTheme, theme.syntax] as const] : [],
    ),
  )("%s keeps the syntax colors of Pierre's %s", async (name, syntax) => {
    const resolved = (await resolveTheme(name, "highlights")).zed!.style;
    const upstream = (await resolveTheme(syntax, "highlights")).zed!.style;
    expect(resolved.syntax).toEqual(upstream.syntax);
    expect(resolved["editor.foreground"]).toBe(upstream["editor.foreground"] ?? upstream.text);
  });

  // Med's own rules: each capture takes the rule TextMate would apply.
  test.each(
    themes.flatMap((theme) =>
      typeof theme.syntax === "string" ? [] : [[theme.pierreTheme, theme.syntax] as const],
    ),
  )("%s colors code by its TextMate rules", async (name, rules: SyntaxTheme) => {
    const resolved = (await resolveTheme(name, "highlights")).zed!.style;
    const ruleColor = (scope: string) =>
      rules.rules.find((rule) => rule.scope.includes(scope))?.color;
    const color = (capture: string) => {
      const value = resolved.syntax![capture];
      return typeof value === "string" ? value : value?.color;
    };
    expect(resolved["editor.foreground"]).toBe(rules.foreground);
    expect(color("comment")).toBe(ruleColor("comment"));
    expect(color("string")).toBe(ruleColor("string"));
    expect(color("keyword")).toBe(ruleColor("keyword"));
    expect(color("function")).toBe(ruleColor("entity.name.function"));
  });

  test("maps TextMate rules to captures by TextMate's own precedence", () => {
    const syntax = zedSyntax({
      foreground: "#000000",
      rules: [
        { scope: ["keyword"], color: "#111111" },
        { scope: ["keyword.operator"], color: "#222222" },
        { scope: ["string"], color: "#333333" },
        { scope: ["string"], color: "#444444", style: "italic" },
        { scope: ["markup.heading"], style: "bold" },
      ],
    });
    // The longest selector wins; of two as long, the later one.
    expect(syntax.keyword).toEqual({ color: "#111111" });
    expect(syntax["keyword.operator"]).toEqual({ color: "#222222" });
    expect(syntax.string).toEqual({ color: "#444444", font_style: "italic" });
    // A style without a color keeps the parent capture's color.
    expect(syntax["markup.heading"]).toEqual({ font_weight: 700 });
    // A capture no rule reaches is left to its parent.
    expect(syntax.function).toBeUndefined();
  });
});
