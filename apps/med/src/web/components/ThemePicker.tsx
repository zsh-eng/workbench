import { Icon } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";
import { focusPaletteInput } from "../data/palette-focus";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import { themeController, themes, useTheme, type Theme } from "../themes";
import { tokens, ui } from "../theme.stylex";

export interface ThemePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThemePicker({ open, onOpenChange }: ThemePickerProps) {
  const { active, saved, persistenceError } = useTheme();
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
      items={themes}
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
          <Dialog.Backdrop {...stylex.props(styles.backdrop, ui.instant)} />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            {...stylex.props(styles.popup, ui.instant)}
          >
            <div {...stylex.props(styles.heading)}>
              <Dialog.Title {...stylex.props(styles.title)}>Theme</Dialog.Title>
              <Dialog.Close
                {...stylex.props(ui.button, styles.close)}
                aria-label="Close theme picker"
              >
                <ShortcutKeys value="Esc" />
              </Dialog.Close>
            </div>
            <Dialog.Description {...stylex.props(styles.description)}>
              Preview with ↑ ↓. Press Enter to save. Escape restores your theme.
            </Dialog.Description>
            <div {...stylex.props(styles.search)}>
              <Icon name="search" size={16} />
              <Combobox.Input
                ref={inputRef}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Search themes"
                placeholder="Search themes…"
                {...stylex.props(styles.input)}
              />
            </div>
            <Combobox.Empty>
              <div {...stylex.props(styles.empty)}>No themes found.</div>
            </Combobox.Empty>
            <Combobox.List {...stylex.props(styles.list)} aria-label="Themes">
              {(theme: Theme) => (
                <Combobox.Item
                  key={theme.id}
                  value={theme}
                  onFocus={() => themeController.preview(theme.id)}
                  className={(state) =>
                    stylex.props(styles.item, state.highlighted && styles.highlighted).className
                  }
                >
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
                  <span {...stylex.props(styles.name)}>{theme.label}</span>
                  <span {...stylex.props(styles.kind)}>{theme.appearance}</span>
                  <span
                    {...stylex.props(styles.saved)}
                    aria-label={saved.id === theme.id ? "Saved theme" : undefined}
                  >
                    {saved.id === theme.id ? "✓" : ""}
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
            <div {...stylex.props(styles.footer)}>
              <span>{active.label}</span>
              <span {...stylex.props(ui.grow)} />
              <span>{active.id === saved.id ? "Saved theme" : "Enter to save"}</span>
            </div>
            {persistenceError && (
              <p role="status" {...stylex.props(styles.error)}>
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
  backdrop: { position: "fixed", inset: 0, backgroundColor: "#00000024", zIndex: 90 },
  popup: {
    position: "fixed",
    top: "15vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(460px, calc(100vw - 32px))",
    maxHeight: "75vh",
    overflowY: "auto",
    boxSizing: "border-box",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 16,
    backgroundColor: tokens.panel,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 12,
    outline: "none",
    zIndex: 91,
  },
  heading: { display: "flex", alignItems: "center", gap: 10, paddingTop: 10, paddingInline: 16 },
  title: { fontSize: 13, fontWeight: 600, margin: 0 },
  close: { marginLeft: "auto", fontSize: 10, minHeight: 24 },
  description: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 12,
    paddingInline: 16,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  input: {
    flex: "1",
    minWidth: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    outline: "none",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
  },
  list: {
    maxHeight: "min(360px, 45vh)",
    overflowY: "auto",
    paddingInline: 6,
    paddingBlock: 6,
    outline: "none",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 34,
    paddingInline: 10,
    borderRadius: 8,
    color: tokens.text,
    cursor: "default",
    outline: "none",
  },
  highlighted: { backgroundColor: tokens.selected },
  name: { flex: "1", fontSize: 12 },
  kind: { color: tokens.muted, fontSize: 10 },
  saved: { width: 12, color: tokens.accent, fontSize: 12 },
  swatches: { display: "flex", gap: 3, alignItems: "center" },
  swatch: (color: string) => ({
    width: 8,
    height: 14,
    borderRadius: 2,
    backgroundColor: color,
    boxShadow: "inset 0 0 0 1px #80808030",
  }),
  empty: { color: tokens.muted, paddingBlock: 24, textAlign: "center" },
  footer: {
    display: "flex",
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    paddingBlock: 8,
    paddingInline: 16,
    color: tokens.muted,
    fontSize: 10,
  },
  error: { margin: 0, paddingBlock: 8, paddingInline: 16, color: tokens.warning, fontSize: 11 },
});
