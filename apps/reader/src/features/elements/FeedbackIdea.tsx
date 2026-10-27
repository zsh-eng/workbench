import { showUndoToast } from "@/components/UndoToast";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import {
  IslandNote,
  IslandNotice,
  IslandSurface,
  ISLAND_SURFACE,
  type IslandNoticeState,
} from "@/features/reader/NotesIsland";
import { NotebookCountIcon } from "@/features/reader/shared/NotebookCountIcon";
import { flyWords, morphPill } from "@/lib/feedback-motion";
import { cn } from "@/lib/utils";
import {
  SPRINGS,
  springCurve,
  springTransition,
} from "@workbench/elements/spring";
import { ArrowLeft, ArrowUp, PencilLine } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export type FeedbackIdeaId = "island" | "bubble" | "pill";

type Island = "none" | "tools" | "compose" | "note" | "notice";

const PASSAGE =
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.";
const NOTE = "Worth rereading: the whole book starts from boredom.";

/**
 * Feedback for a saved note, a copy and a deletion, three ways, on Reader's
 * real Notes Island. `island` is what ships: the words fly into the
 * notice's mark, the check draws itself, and a deleted note dissolves into
 * its Undo. `bubble` sends the words into the notes bubble instead and
 * shows no notice. `pill` grows each word out of the button you tapped.
 */
export function FeedbackIdea() {
  const [params] = useSearchParams();
  const idea: FeedbackIdeaId =
    params.get("idea") === "bubble"
      ? "bubble"
      : params.get("idea") === "pill"
        ? "pill"
        : "island";
  const framed = window.parent !== window;
  const reduceMotion = useReducedMotion() ?? false;
  const [island, setIsland] = useState<Island>("none");
  const [notice, setNotice] = useState<IslandNoticeState | null>(null);
  const [count, setCount] = useState(11);
  const [noted, setNoted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const send = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // `?run=auto` taps through the page once, for recordings: copy, write and
  // save a note, delete it and Undo, then the Undo toast and its Undo.
  const auto = params.get("run") === "auto";
  useEffect(() => {
    if (!auto) return;
    const tap = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.click();
    const steps: [number, string][] = [
      [0.8, "[data-feedback-passage]"],
      [1.7, '[aria-label="Copy text"]'],
      [3.0, "[data-feedback-note]"],
      [4.0, '[aria-label="Save note"]'],
      [6.2, "[data-feedback-passage]"],
      [7.2, '[aria-label="Delete note"]'],
      [8.8, "[data-feedback-island] [role=status] button"],
      [10.6, "[data-feedback-toast]"],
      [12.2, ".wb-toast-action"],
    ];
    const timers = steps.map(([at, selector]) =>
      window.setTimeout(() => tap(selector), at * 1000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [auto]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => {
        setNotice(null);
        setIsland((value) => (value === "notice" ? "none" : value));
      },
      notice.undo ? 8000 : 1500,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = (next: IslandNoticeState) => {
    setNotice(next);
    setIsland("notice");
  };

  const copy = (button: HTMLElement) => {
    setCopied(true);
    if (idea === "pill" && !reduceMotion) morphPill(button, "Copied");
  };

  const save = () => {
    const rect = field.current?.getBoundingClientRect();
    const from = rect ? { rect, text: NOTE } : undefined;
    setNoted(true);
    if (idea === "bubble") {
      setIsland("none");
      setAnnouncement("Saved to notebook");
      const target = bubble.current;
      // The bubble swells as the words land, and its count rolls on.
      const land = () => {
        setCount((value) => value + 1);
        if (!target || reduceMotion) return;
        const swell = springCurve(SPRINGS.pop, 12);
        target.animate([{ scale: "1.14" }, { scale: "1" }], {
          duration: swell.duration,
          easing: swell.easing,
        });
      };
      if (from && target && !reduceMotion) flyWords(from, target, land);
      else land();
      return;
    }
    if (idea === "pill") {
      setIsland("none");
      setAnnouncement("Saved to notebook");
      if (send.current && !reduceMotion) morphPill(send.current, "Saved");
      setCount((value) => value + 1);
      return;
    }
    setCount((value) => value + 1);
    showNotice({
      key: Date.now(),
      label: "Saved to notebook",
      color: "green",
      from,
    });
  };

  const remove = () => {
    setNoted(false);
    setCount((value) => value - 1);
    const key = Date.now();
    showNotice({
      key,
      label: "Note deleted",
      undo: () => {
        setNoted(true);
        setCount((value) => value + 1);
        showNotice({ key: key + 1, label: "Note restored" });
      },
    });
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      {!framed && (
        <div className="flex h-12 items-center gap-2 border-b border-border/70 px-3">
          <Link
            to="/debug/elements/feedback"
            aria-label="Back to feedback ideas"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-sm font-medium">Feedback</span>
        </div>
      )}
      <div className="px-6 pt-10 font-serif text-[17px] leading-[1.6]">
        <p className="mb-4 indent-6">
          <button
            type="button"
            data-feedback-passage=""
            onClick={() => setIsland(noted ? "note" : "tools")}
            className="rounded-[3px] bg-[var(--green-secondary)] text-left text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {PASSAGE}
          </button>{" "}
          “And what is the use of a book,” thought Alice, “without pictures or
          conversations?”
        </p>
        <p className="font-sans text-[13px] leading-relaxed text-muted-foreground">
          Tap the green passage. Copy it, write a note and save it, then tap it
          again to delete the note and Undo.
        </p>
        <button
          type="button"
          data-feedback-toast=""
          onClick={() => {
            // Undo turns the same toast into "Restored", as the notebook's
            // does.
            const shown = showUndoToast({
              message: "Highlight deleted",
              onUndo: () => shown.done(),
            });
          }}
          className="mt-4 h-9 rounded-full bg-secondary px-4 font-sans text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show the Undo toast
        </button>
      </div>

      {/* The notes bubble, where the footer keeps it in the Reader. */}
      <div className="absolute right-[10px] bottom-[max(env(safe-area-inset-bottom),14px)]">
        <span
          ref={bubble}
          className={cn(
            "flex h-11 items-center rounded-full px-3",
            ISLAND_SURFACE,
            island !== "none" && "invisible",
          )}
          aria-label={`${count} in the notebook`}
          role="img"
        >
          <CountRoll count={count} />
        </span>
      </div>

      <span className="sr-only" role="status">
        {announcement}
      </span>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),14px)]">
        <AnimatePresence>
          {island !== "none" && (
            <motion.div
              key="island"
              data-feedback-island=""
              initial={{ opacity: 0, transform: "translateY(16px)" }}
              animate={{ opacity: 1, transform: "none" }}
              exit={{ opacity: 0, transform: "translateY(12px)" }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            >
              <IslandSurface
                layerKey={island}
                exit={island === "notice" && notice?.undo ? "dissolve" : "fade"}
                radius={island === "tools" ? 26 : island === "notice" ? 22 : 24}
              >
                {island === "tools" && (
                  <div className="flex h-[52px] items-center gap-3 pr-1.5 pl-4 whitespace-nowrap">
                    {(["yellow", "green", "blue", "magenta"] as const).map(
                      (color) => (
                        <span
                          key={color}
                          aria-hidden="true"
                          className="size-6 rounded-full"
                          style={{ background: `var(--${color}-secondary)` }}
                        />
                      ),
                    )}
                    <span aria-hidden="true" className="h-5 w-px bg-border" />
                    <div className="-ml-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Copy text"
                        onClick={(event) => copy(event.currentTarget)}
                        className={cn(
                          "flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring",
                          copied && "text-foreground",
                        )}
                      >
                        <CopyFeedbackIcon
                          copied={copied}
                          className="size-[18px]"
                        />
                      </button>
                      <button
                        type="button"
                        data-feedback-note=""
                        onClick={() => setIsland("compose")}
                        className="flex h-10 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <PencilLine className="size-4" aria-hidden="true" />
                        Note
                      </button>
                    </div>
                  </div>
                )}
                {island === "compose" && (
                  <div className="flex w-[min(368px,calc(100vw-22px))] items-end gap-2 p-2.5">
                    <textarea
                      ref={field}
                      aria-label="Write a note"
                      defaultValue={NOTE}
                      rows={2}
                      className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] leading-[1.45] outline-none"
                    />
                    <button
                      ref={send}
                      type="button"
                      aria-label="Save note"
                      onClick={save}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {island === "note" && (
                  <IslandNote
                    width={Math.min(368, window.innerWidth - 22)}
                    text={NOTE}
                    meta="p. 1 · Today"
                    copyText={() => PASSAGE}
                    onEdit={() => setIsland("compose")}
                    onDelete={remove}
                    onShowTools={() => setIsland("tools")}
                    onClose={() => setIsland("none")}
                  />
                )}
                {island === "notice" && notice && (
                  <IslandNotice
                    key={notice.key}
                    notice={notice}
                    onUndo={() => notice.undo?.()}
                  />
                )}
              </IslandSurface>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** The bubble's count: the old number rolls up and out as the new one
 * rolls in, on the pop spring. */
function CountRoll({ count }: { count: number }) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <span className="relative grid size-[26px] overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={count}
          className="col-start-1 row-start-1"
          initial={reduceMotion ? { opacity: 0 } : { y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: -12, opacity: 0 }}
          transition={springTransition(SPRINGS.pop)}
        >
          <NotebookCountIcon count={count} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
