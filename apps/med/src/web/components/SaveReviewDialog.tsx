import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useRef, useState } from "react";
import type { ParsedReviewFile } from "../../shared/review";
import { briefTitle, countCitedFiles } from "../data/brief";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

/** A brief pasted onto live changes: save the comparison with it, so its line
 * references keep pointing at the code they describe. */
export function SaveReviewDialog({
  brief,
  files,
  root,
  comparisonLabel,
  onSave,
  onClose,
}: {
  brief: string | null;
  files: ParsedReviewFile[];
  root?: string;
  comparisonLabel: string;
  onSave(title: string): Promise<void>;
  onClose(): void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A newly pasted brief proposes its own title.
  const [titled, setTitled] = useState<string | null>(null);
  if (brief && brief !== titled) {
    setTitled(brief);
    setTitle(briefTitle(brief));
    setError("");
  }
  const titleInput = useRef<HTMLInputElement>(null);
  const cited = useMemo(
    () => (brief ? countCitedFiles(brief, files, root) : 0),
    [brief, files, root],
  );
  const save = async () => {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review could not be saved.");
      setSaving(false);
    }
  };
  return (
    <Dialog.Root
      open={brief !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop)} />
        <Dialog.Popup initialFocus={titleInput} {...stylex.props(styles.dialog)}>
          <Dialog.Title {...stylex.props(styles.title)}>
            <Icon name="brief" size={15} />
            Save as a review
          </Dialog.Title>
          <Dialog.Description {...stylex.props(styles.hint)}>
            Med keeps {comparisonLabel.toLowerCase()} with the pasted brief, so its links keep
            pointing at the lines it describes.
          </Dialog.Description>
          <label {...stylex.props(styles.field)}>
            Title
            <input
              ref={titleInput}
              aria-label="Review title"
              value={title}
              maxLength={200}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
              {...stylex.props(ui.input)}
            />
          </label>
          <p {...stylex.props(styles.summary)}>
            The brief cites {cited} of {files.length} changed{" "}
            {files.length === 1 ? "file" : "files"}.
          </p>
          {error && (
            <p role="alert" {...stylex.props(styles.hint)}>
              {error}
            </p>
          )}
          <div {...stylex.props(styles.actions)}>
            <Dialog.Close {...stylex.props(ui.button)} disabled={saving}>
              Cancel
            </Dialog.Close>
            <button
              {...stylex.props(ui.button, ui.primary, ui.pressable)}
              disabled={saving || !title.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save review"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 6px) scale(0.985)" },
  to: { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
});
const styles = stylex.create({
  backdrop: { zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "20vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(440px, 90vw)",
    boxSizing: "border-box",
    padding: 20,
    borderRadius: 12,
    backgroundColor: tokens.raised,
    color: tokens.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
    fontFamily: tokens.ui,
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "200ms",
    animationTimingFunction: tokens.easeOut,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    fontSize: 14,
    fontWeight: 550,
  },
  hint: { fontSize: 12, color: tokens.muted, lineHeight: 1.5, marginBlock: 8 },
  field: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 6,
    marginBlock: 14,
    fontSize: 12,
    color: tokens.muted,
  },
  summary: { margin: 0, fontSize: 12, color: tokens.faint },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
});
