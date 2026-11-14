import { Icon } from "./Icon";
import { Matched, matchRanges, PaletteTitle, usePaletteFade } from "./Palette";
import { focusPaletteInput } from "../data/palette-focus";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import { themeController, themeGroups, useTheme, type Theme } from "../themes";
import { picked, tokens, ui } from "../theme.stylex";

export interface ThemePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThemePicker({ open, onOpenChange }: ThemePickerProps) {
  const { saved, persistenceError } = useTheme();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fade = usePaletteFade<HTMLDivElement>();

  useEffect(() => {
    if (!open) {
      themeController.cancelPreview();
    }
  }, [open]);
  useEffect(() => () => themeController.cancelPreview(), []);

  function setOpen(next: boolean) {
    if (!next) themeController.cancelPreview();
    onOpenChange(next);
  }

  return (
    <Combobox.Root<Theme>
      inline
      open={open}
      onOpenChange={setOpen}
      items={themeGroups}
      value={saved}
      inputValue={query}
      onInputValueChange={(value, details) => {
        if (details.reason === "input-change" || details.reason === "input-clear") setQuery(value);
      }}
      itemToStringLabel={(theme) => theme.label}
      autoHighlight
      onItemHighlighted={(theme) => {
        if (open && theme) themeController.preview(theme.id);
      }}
      onValueChange={(theme) => {
        if (!theme) return;
        themeController.commit(theme.id);
        onOpenChange(false);
      }}
    >
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop
            {...stylex.props(ui.scrim, ui.paletteScrim, styles.backdrop, ui.instant)}
          />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            {...stylex.props(ui.palette, ui.instant)}
          >
            <PaletteTitle>Theme</PaletteTitle>
            <Dialog.Description {...stylex.props(ui.srOnly)}>
              Preview with ↑ ↓. Press Enter to save. Escape restores your theme.
            </Dialog.Description>
            <div {...stylex.props(ui.paletteInput)}>
              <Icon name="search" />
              <Combobox.Input
                ref={inputRef}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Search themes"
                placeholder="Search themes…"
                {...stylex.props(ui.paletteField)}
              />
            </div>
            <Combobox.Empty>
              <p {...stylex.props(ui.paletteEmpty)}>No themes match “{query.trim()}”</p>
            </Combobox.Empty>
            <Combobox.List ref={fade} {...stylex.props(ui.paletteList)} aria-label="Themes">
              {(group: (typeof themeGroups)[number]) => (
                <Combobox.Group
                  key={group.family}
                  items={group.items}
                  {...stylex.props(ui.paletteGroup)}
                >
                  <Combobox.GroupLabel {...stylex.props(ui.label, ui.paletteSection)}>
                    {group.family}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(theme: Theme) => (
                      <Combobox.Item
                        key={theme.id}
                        value={theme}
                        onFocus={() => themeController.preview(theme.id)}
                        className={(state) =>
                          stylex.props(
                            ui.paletteRow,
                            state.highlighted && [ui.paletteRowOn, picked],
                          ).className
                        }
                      >
                        {/* The theme's canvas, with its accent in the lower right half. */}
                        <span
                          aria-hidden="true"
                          data-appearance={theme.appearance}
                          {...stylex.props(styles.swatch(theme.palette.canvas))}
                        >
                          <span {...stylex.props(styles.accent(theme.palette.accent))} />
                        </span>
                        <span {...stylex.props(ui.paletteRowText)}>
                          <Matched text={theme.label} ranges={matchRanges(theme.label, query)} />
                        </span>
                        {/* Screen readers skip it where the name says it already. */}
                        <span
                          aria-hidden={/\b(light|dark)\b/i.test(theme.label) || undefined}
                          {...stylex.props(ui.paletteAside)}
                        >
                          {theme.appearance === "light" ? "Light" : "Dark"}
                        </span>
                        {saved.id === theme.id && (
                          <span
                            role="img"
                            aria-label="Saved theme"
                            {...stylex.props(ui.paletteCheck)}
                          >
                            <Icon name="check" />
                          </span>
                        )}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
            {persistenceError && (
              <p role="status" {...stylex.props(ui.paletteNotice, styles.error)}>
                {persistenceError}
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Combobox.Root>
  );
}

const styles = stylex.create({
  // Nearly clear: the whole app previews the highlighted theme behind the list.
  backdrop: { backgroundColor: `color-mix(in srgb, ${tokens.panel} 16%, transparent)` },
  swatch: (canvas: string) => ({
    position: "relative",
    flexShrink: 0,
    width: 16,
    height: 16,
    borderRadius: "50%",
    overflow: "hidden",
    backgroundColor: canvas,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.text} 16%, transparent)`,
  }),
  accent: (color: string) => ({
    position: "absolute",
    inset: 0,
    backgroundColor: color,
    clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
  }),
  error: { color: tokens.warning },
});
