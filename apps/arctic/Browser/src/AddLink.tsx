import { Popover } from "@base-ui/react/popover";
import { ArrowUp, Link2, Plus } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { editLibrary, removeArticle, type Article } from "./articles";
import { articleId, canonicalURL, saveLink } from "./links";
import { listMotion } from "./motion";
import { articles as projected, reportError, showToast, useSession } from "./state";
import { useAboveKeyboard } from "./surface";
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
  // Not a link: nothing moves.
  if (!url) return { kind: "invalid" } as const;
  if (!document.startViewTransition) fresh = await articleId(url);
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

/**
 * The library's + button where a pointer reaches it: a popover under the
 * button, or beside the sidebar's row with its shortcut. A phone saves from
 * its bottom bar instead (`LinkDock`).
 */
export function AddLinkButton({ row = false }: { row?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = row ? (
    <button type="button" className="side-item side-add">
      <Plus size={16} />
      Save a link
      <kbd aria-hidden>⌘V</kbd>
    </button>
  ) : (
    <button type="button" className="icon-button" aria-label="Save a link">
      <Plus size={20} />
    </button>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {row ? (
        <Popover.Trigger render={button} />
      ) : (
        <Tip label="Save a link" keys="⌘V">
          <Popover.Trigger render={button} />
        </Tip>
      )}
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={8}
          align={row ? "start" : "end"}
          side={row ? "right" : "bottom"}
        >
          <Popover.Popup className="menu link-popover">
            <LinkForm onDone={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A link being typed, and saving it: one for the popover, one for the dock.
 * A link closes its field first, so the list moves with nothing over it.
 */
function useLinkField(onSaved: () => void) {
  const session = useSession();
  const show = useShow();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = async (text: string) => {
    if (!text.trim()) return;
    if (!canonicalURL(text)) {
      setError("That is not a web address. Links start with https://.");
      input.current?.focus();
      return;
    }
    setValue("");
    onSaved();
    await addLink(session, text, show).catch(reportError);
  };
  return {
    input,
    value,
    error,
    change(text: string) {
      setValue(text);
      setError("");
    },
    reset() {
      setValue("");
      setError("");
    },
    submit,
  };
}

/** The field's attributes: a URL keyboard, and nothing changed as it is typed. */
const URL_FIELD = {
  type: "url",
  inputMode: "url",
  autoComplete: "off",
  autoCapitalize: "off",
  spellCheck: false,
  placeholder: "Paste a link",
} as const;

function LinkForm({ onDone }: { onDone: () => void }) {
  const link = useLinkField(onDone);
  const { input } = link;
  useLayoutEffect(() => input.current?.focus({ preventScroll: true }), [input]);
  return (
    <form
      className="link-form"
      // Arctic reads "example.com/page" as a link; the browser's check does not.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void link.submit(link.value);
      }}
    >
      <label className="link-field">
        <span className="visually-hidden">Link</span>
        <input
          ref={input}
          {...URL_FIELD}
          value={link.value}
          aria-invalid={link.error ? true : undefined}
          onChange={(event) => link.change(event.target.value)}
        />
      </label>
      <p className={link.error ? "link-note error" : "link-note"} role="status">
        {link.error ||
          "Arctic on your iPhone adds the title, image and topics when it next opens."}
      </p>
      <div className="link-actions">
        <button
          type="submit"
          className="button primary"
          disabled={!link.value.trim()}
        >
          Save
        </button>
      </div>
    </form>
  );
}

/**
 * A phone's bottom bar, which saves links the way Safari edits its address:
 * + turns the search capsule into a link field above the keyboard, and the
 * + turns to × to put it back. The list stays in view under a light scrim,
 * and a tap on it cancels. An empty field offers Paste; a typed one, Save.
 */
export function LinkDock({ children }: { children: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const link = useLinkField(() => close());
  const { input } = link;
  const canPaste = !!navigator.clipboard?.readText;
  useAboveKeyboard(dock, adding);

  const open = () => {
    // Render the field and focus it in this tap, so the phone opens its
    // keyboard. Without preventScroll the page would scroll to the field.
    flushSync(() => setAdding(true));
    input.current?.focus({ preventScroll: true });
  };
  function close() {
    input.current?.blur();
    setAdding(false);
    link.reset();
  }
  // A press on a control keeps the field focused, and the keyboard up.
  // Focus moves on mousedown, and Safari on iOS sends one for each tap even
  // when pointerdown is cancelled. Without this, the blur closes an empty
  // field, and the tap's click lands on the closed form instead of Paste.
  const keepFocus = (event: { preventDefault: () => void }) =>
    event.preventDefault();

  return (
    <>
      {adding && (
        <div
          className="dock-scrim"
          aria-hidden
          onPointerDown={(event) => {
            event.preventDefault();
            close();
          }}
        />
      )}
      <div
        className="library-dock"
        ref={dock}
        data-adding={adding || undefined}
      >
        {link.error && (
          <p className="dock-note" role="alert">
            {link.error}
          </p>
        )}
        <div className="dock-row">
          <div className="dock-slot">
            <div className="dock-search" inert={adding}>
              {children}
            </div>
            <form
              className="dock-link"
              inert={!adding}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void link.submit(link.value);
              }}
            >
              <Link2 size={17} aria-hidden />
              <input
                ref={input}
                {...URL_FIELD}
                aria-label="Link"
                enterKeyHint="go"
                value={link.value}
                aria-invalid={link.error ? true : undefined}
                onChange={(event) => link.change(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  close();
                  add.current?.focus({ preventScroll: true });
                }}
                // The keyboard put away on an empty field ends the edit.
                onBlur={() => {
                  if (!link.value.trim()) close();
                }}
              />
              {link.value.trim() ? (
                <button
                  type="submit"
                  className="dock-save"
                  aria-label="Save"
                  onMouseDown={keepFocus}
                >
                  <ArrowUp size={18} />
                </button>
              ) : (
                canPaste && (
                  <button
                    type="button"
                    className="dock-paste"
                    onMouseDown={keepFocus}
                    onClick={() =>
                      navigator.clipboard.readText().then(
                        (text) => {
                          link.change(text.trim());
                          void link.submit(text);
                        },
                        // Paste declined: the field stays for typing.
                        () => input.current?.focus(),
                      )
                    }
                  >
                    Paste
                  </button>
                )
              )}
            </form>
          </div>
          <button
            ref={add}
            type="button"
            className="icon-button dock-add"
            aria-label={adding ? "Cancel" : "Save a link"}
            aria-expanded={adding}
            onMouseDown={adding ? keepFocus : undefined}
            onClick={adding ? close : open}
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
    </>
  );
}
