import { Icon } from "./Icon";
import { PaletteHeader, PaletteHint, plural } from "./Palette";
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
            <PaletteHeader title="Theme" closeLabel="Close theme picker" />
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
              <div {...stylex.props(ui.paletteEmpty)}>No themes found.</div>
            </Combobox.Empty>
            <Combobox.List {...stylex.props(ui.paletteList)} aria-label="Themes">
              {(group: (typeof themeGroups)[number]) => (
                <Combobox.Group key={group.family} items={group.items}>
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
                            state.highlighted && [ui.menuHighlighted, picked],
                          ).className
                        }
                      >
                        {/* The appearance, in place of the words light and dark. */}
                        <span
                          data-appearance={theme.appearance}
                          {...stylex.props(ui.paletteRowIcon)}
                        >
                          <Icon name={theme.appearance === "light" ? "sun" : "moon"} size={14} />
                        </span>
                        <span {...stylex.props(ui.paletteRowText)}>{theme.label}</span>
                        <span {...stylex.props(styles.swatches)} aria-hidden="true">
                          {[
                            theme.palette.canvas,
                            theme.palette.accent,
                            theme.palette.green,
                            theme.palette.red,
                          ].map((color, index) => (
                            <span key={index} {...stylex.props(styles.swatch(color))} />
                          ))}
                        </span>
                        <span {...stylex.props(ui.paletteCheck)}>
                          {saved.id === theme.id && (
                            <span
                              role="img"
                              aria-label="Saved theme"
                              {...stylex.props(styles.check)}
                            >
                              <Icon name="check" size={14} />
                            </span>
                          )}
                        </span>
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
            <div {...stylex.props(ui.paletteFooter)}>
              <PaletteHint keys="↑ ↓">Preview</PaletteHint>
              <PaletteHint keys="↵">Save</PaletteHint>
              <PaletteHint keys="Esc">Restore</PaletteHint>
              <span {...stylex.props(ui.paletteCount)}>
                <ThemeCount />
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Combobox.Root>
  );
}

/** The themes that the search shows. */
function ThemeCount() {
  const groups = Combobox.useFilteredItems<(typeof themeGroups)[number]>();
  return plural(
    groups.reduce((count, group) => count + group.items.length, 0),
    "theme",
  );
}

const styles = stylex.create({
  // Nearly clear: the whole app previews the highlighted theme behind the list.
  backdrop: { backgroundColor: `color-mix(in srgb, ${tokens.panel} 16%, transparent)` },
  swatches: { display: "flex", flexShrink: 0, gap: 3, alignItems: "center" },
  swatch: (color: string) => ({
    width: 8,
    height: 14,
    borderRadius: `calc(2px * ${tokens.round})`,
    backgroundColor: color,
    boxShadow: "inset 0 0 0 1px #80808030",
  }),
  check: { display: "inline-flex" },
  error: { color: tokens.warning },
});
