import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { ui } from "../theme.stylex";
import { ShortcutKeys } from "./ShortcutKeys";

/**
 * A palette's header: its title, then what it searches, its controls, and
 * the Esc keycap, which closes it. A context given as text truncates first.
 */
export function PaletteHeader({
  title,
  context,
  closeLabel,
  children,
}: {
  title: ReactNode;
  context?: ReactNode;
  closeLabel: string;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(ui.paletteHeader)}>
      <Dialog.Title {...stylex.props(ui.paletteTitle)}>{title}</Dialog.Title>
      {typeof context === "string" ? (
        <span title={context} {...stylex.props(ui.paletteContext)}>
          {context}
        </span>
      ) : (
        context
      )}
      <span {...stylex.props(ui.grow)} />
      {children}
      <Dialog.Close aria-label={closeLabel} {...stylex.props(ui.button, ui.paletteClose)}>
        <ShortcutKeys value="Esc" />
      </Dialog.Close>
    </div>
  );
}

/** A footer's keycaps and the verb that they do, such as ↵ Open. */
export function PaletteHint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span {...stylex.props(ui.paletteHint)}>
      <ShortcutKeys value={keys} />
      {children}
    </span>
  );
}

/** A footer's count and its noun, such as "1 command" or "99 commands". */
export const plural = (count: number, noun: string, nouns = `${noun}s`) =>
  `${count} ${count === 1 ? noun : nouns}`;
