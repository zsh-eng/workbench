import * as stylex from "@stylexjs/stylex";
import type { KeyboardEvent, Ref } from "react";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { tooltip } from "./ToolButton";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

/** Where the matches are: the current one of how many, or why there are none. */
export type FindCount = { current: number; total: number } | { error: string };

const OPTIONS = [
  { key: "caseSensitive", label: "Match case", glyph: "Aa", code: "KeyC", keys: "Alt+C" },
  { key: "wholeWord", label: "Whole word", glyph: "ab", code: "KeyW", keys: "Alt+W" },
  { key: "regexp", label: "Regular expression", glyph: ".*", code: "KeyR", keys: "Alt+R" },
] as const;

/**
 * Find, the same in diffs and in files: the query, Match case, Whole word,
 * and Regular expression, the count, Previous, Next, and Close, at the top
 * right of what it finds in. Enter goes to the next match and ⇧Enter to the
 * previous one; ⌥C, ⌥W, and ⌥R flip the options; Escape closes.
 *
 * Vim's / and ? open it with their mark in place of the search icon. There
 * Enter goes to the match and back to the file, where n and N go on.
 */
export function FindBar({
  query,
  onQuery,
  options,
  onOptions,
  count,
  onNext,
  onPrevious,
  onSubmit,
  onClose,
  placeholder = "Find",
  mark,
  inputRef,
}: {
  query: string;
  onQuery(query: string): void;
  options: FindOptions;
  onOptions(options: FindOptions): void;
  /** Null before there is a query. */
  count: FindCount | null;
  onNext(): void;
  onPrevious(): void;
  /** Enter, when it does more than go to the next match, as in Vim. */
  onSubmit?(): void;
  onClose(): void;
  placeholder?: string;
  /** Vim's search, forward (/) or back (?). */
  mark?: "/" | "?";
  inputRef?: Ref<HTMLInputElement>;
}) {
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const option = event.altKey && OPTIONS.find((entry) => entry.code === event.code);
    if (option) {
      onOptions({ ...options, [option.key]: !options[option.key] });
    } else if (event.key === "Enter") {
      if (event.shiftKey) onPrevious();
      else (onSubmit ?? onNext)();
    } else if (event.key === "Escape") {
      onClose();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const empty = !!count && ("error" in count || !count.total);
  return (
    <div role="search" aria-label="Find" {...stylex.props(styles.bar)}>
      {mark ? (
        <span
          aria-label={mark === "/" ? "Search forward" : "Search back"}
          {...stylex.props(styles.mark)}
        >
          {mark}
        </span>
      ) : (
        <Icon name="search" size={14} />
      )}
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={keyDown}
        aria-label={placeholder}
        aria-invalid={!!count && "error" in count}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        main-field="true"
        {...stylex.props(styles.input)}
      />
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-label={option.label}
          aria-pressed={options[option.key]}
          {...tooltip(option.label, option.keys)}
          // The field keeps the focus, so typing goes on.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOptions({ ...options, [option.key]: !options[option.key] })}
          {...stylex.props(
            ui.button,
            styles.option,
            option.key === "wholeWord" && styles.word,
            options[option.key] && styles.optionOn,
          )}
        >
          {option.glyph}
        </button>
      ))}
      <span aria-live="polite" {...stylex.props(styles.count, empty && styles.none)}>
        {!count
          ? ""
          : "error" in count
            ? count.error
            : count.total
              ? `${count.current || "?"} of ${count.total}`
              : "No results"}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        {...tooltip("Previous match", "Shift+Enter")}
        disabled={!count || empty}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPrevious}
        {...stylex.props(ui.button, ui.iconButton, styles.button)}
      >
        <Icon name="arrowUp" size={14} />
      </button>
      <button
        type="button"
        aria-label="Next match"
        {...tooltip("Next match", "Enter")}
        disabled={!count || empty}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onNext}
        {...stylex.props(ui.button, ui.iconButton, styles.button)}
      >
        <Icon name="arrowDown" size={14} />
      </button>
      <button
        type="button"
        aria-label="Close find"
        {...tooltip("Close", "Escape")}
        onClick={onClose}
        {...stylex.props(ui.button, ui.iconButton, styles.button)}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

const styles = stylex.create({
  bar: {
    position: "absolute",
    top: 8,
    right: 16,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 36,
    boxSizing: "border-box",
    paddingInlineStart: 10,
    paddingInlineEnd: 4,
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    color: tokens.faint,
    fontFamily: tokens.ui,
  },
  mark: {
    width: 14,
    textAlign: "center",
    color: tokens.accent,
    fontFamily: tokens.code,
    fontSize: 13,
    fontWeight: 600,
  },
  input: {
    width: 200,
    height: 28,
    marginInlineStart: 6,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12,
    "::placeholder": { color: tokens.faint, fontFamily: tokens.ui },
  },
  option: {
    width: 24,
    minWidth: 24,
    height: 22,
    minHeight: 22,
    paddingInline: 0,
    justifyContent: "center",
    borderRadius: 5,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  word: { textDecoration: "underline", textUnderlineOffset: 3 },
  optionOn: {
    color: tokens.accent,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 16%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.accent} 45%, transparent)`,
  },
  count: {
    whiteSpace: "nowrap",
    minWidth: 64,
    paddingInline: 6,
    textAlign: "end",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  none: { color: tokens.red },
  button: { width: 26, minWidth: 26, minHeight: 26, height: 26 },
});
