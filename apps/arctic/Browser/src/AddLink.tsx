import { Popover } from "@base-ui/react/popover";
import { ClipboardPaste, Plus } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { editLibrary, removeArticle, type Article } from "./articles";
import { articleId, canonicalURL, saveLink } from "./links";
import { listMotion } from "./motion";
import { articles as projected, reportError, showToast, useSession } from "./state";
import { Sheet, useCompact } from "./surface";
import type { Session } from "./sync/session";
import { Tip } from "./ui";

/**
 * The article saved last on this page. Its card arrives with a motion once;
 * a later render, such as after a folder change, does not repeat it.
 */
let fresh = "";
export function isFresh(id: string) {
  if (id !== fresh) return false;
  fresh = "";
  return true;
}

/**
 * Saves a link and says so, with Undo. A new link goes to the top of Saved;
 * one already there is pointed out instead.
 */
export async function addLink(
  session: Session,
  input: string,
  show: () => void,
) {
  const known = projected(session);
  // The card renders as the records are written, so it is marked first.
  // With view transitions, the list motion brings it in instead.
  const url = canonicalURL(input);
  if (url && !document.startViewTransition) fresh = await articleId(url);
  const result = await listMotion(() => saveLink(session, input, known));
  if (result.kind === "invalid") return result;
  show();
  if (result.kind === "already") {
    fresh = "";
    showToast("Already in Saved");
    return result;
  }
  const before = known.find((article) => article.id === result.id);
  showToast("Saved", {
    label: "Undo",
    run: () => void undo(session, result.id, before),
  });
  return result;
}

async function undo(session: Session, id: string, before?: Article) {
  const article = projected(session).find((item) => item.id === id);
  if (!article) return;
  try {
    // A link from History goes back to History; a new one goes away.
    await listMotion<unknown>(() =>
      before
        ? editLibrary(session.arctic, article, { saved: false })
        : removeArticle(session.arctic, session.copies, article),
    );
    session.syncSoon();
  } catch (error) {
    reportError(error);
  }
}

/** Pasting a link anywhere outside a field saves it. */
export function usePasteToSave() {
  const session = useSession();
  const show = useShow();
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, [contenteditable]")) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    // Only a whole address, so pasted prose is never saved by accident.
    if (!/^https?:\/\/\S+$/i.test(text.trim()) || !canonicalURL(text)) return;
    event.preventDefault();
    void addLink(session, text, show).catch(reportError);
  });
  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, []);
}

/** Shows Saved, where a saved link appears first. */
function useShow() {
  const navigate = useNavigate();
  return () => {
    if (location.pathname !== "/" || location.search)
      navigate("/", { state: { from: location.pathname } });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/** The library's + button: a sheet on phones, a popover elsewhere. */
export function AddLinkButton() {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const button = (
    <button
      type="button"
      className="icon-button"
      aria-label="Save a link"
      onClick={compact ? () => setOpen(true) : undefined}
    >
      <Plus size={20} />
    </button>
  );
  if (compact)
    return (
      <>
        {button}
        <Sheet
          isOpen={open}
          onOpenChange={setOpen}
          title="Save a link"
          heading
          tall
        >
          <LinkForm onDone={() => setOpen(false)} />
        </Sheet>
      </>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="Save a link" keys="⌘V">
        <Popover.Trigger render={button} />
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="menu link-popover">
            <LinkForm onDone={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function LinkForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const show = useShow();
  const compact = useCompact();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canPaste = compact && !!navigator.clipboard?.readText;
  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const result = await addLink(session, text, show);
      if (result.kind === "invalid") {
        setError("That is not a web address. Links start with https://.");
        input.current?.focus();
      } else onDone();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="link-form"
      // Arctic reads "example.com/page" as a link; the browser's check does not.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit(value);
      }}
    >
      <label className="link-field">
        <span className="visually-hidden">Link</span>
        <input
          ref={input}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste a link"
          autoFocus
          data-sheet-autofocus
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
      </label>
      <p className={error ? "link-note error" : "link-note"} role="status">
        {error ||
          "Arctic on your iPhone adds the title, image and topics when it next opens."}
      </p>
      <div className="link-actions">
        {canPaste && (
          <button
            type="button"
            className="button quiet"
            onClick={() =>
              navigator.clipboard.readText().then((text) => {
                setValue(text.trim());
                void submit(text);
              }, reportError)
            }
          >
            <ClipboardPaste size={16} /> Paste and save
          </button>
        )}
        <button
          type="submit"
          className="button primary"
          disabled={!value.trim() || busy}
        >
          Save
        </button>
      </div>
    </form>
  );
}
