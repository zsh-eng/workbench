import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  useIsPresent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { copyEntryText } from "./DesktopNotebookNote";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const THRESHOLD = 72;

/** Owns drag feedback locally: pointer movement never renders the notebook or Reader.
 * Native vertical scrolling wins until a deliberate horizontal drag captures the pointer.
 */
export function NotebookNote({
  kind = "note",
  children,
  onEdit,
  onDelete,
  canEdit,
  disabled,
  editing,
  text,
}: {
  kind?: "note" | "highlight";
  children: ReactNode;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  canEdit: boolean;
  disabled: boolean;
  editing: boolean;
  text: string;
}) {
  const reduceMotion = useReducedMotion();
  const present = useIsPresent();
  const cardOpacity = useMotionValue(1);
  const distance = useMotionValue(0);
  const transform = useTransform(
    distance,
    (value) => `translateX(${-value}px)`,
  );
  const magnitude = useTransform(distance, Math.abs);
  const progress = useTransform(magnitude, [0, THRESHOLD], [0, 1]);
  const opacity = useTransform(magnitude, [4, 48], [0, 1]);
  const [action, setAction] = useState<"edit" | "delete">("edit");
  // Approach from the outer edge, then keep a 12 px gap from the moving card.
  const cueTransform = useTransform(magnitude, (value) => {
    const x = value < 60 ? 24 - value * 0.6 : 48 - value;
    const scale = reduceMotion ? 1 : 0.9 + Math.min(value / 60, 1) * 0.1;
    return `translateX(${action === "edit" ? x : -x}px) scale(${scale})`;
  });
  const burst = useMotionValue(1);
  const burstScale = useTransform(burst, [0, 1], [1, 2.3], {
    ease: cubicBezier(0.23, 1, 0.32, 1),
  });
  const burstTransform = useTransform(burstScale, (value) => `scale(${value})`);
  const ringOpacity = useTransform(burst, [0, 0.3, 1], [0.55, 0.25, 0]);
  const mistOpacity = useTransform(burst, [0, 0.15, 1], [0.15, 0.25, 0]);
  const [armed, setArmed] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
    direction: number;
    armed: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  // Persistence removes the row first. Presence keeps only its visual shell
  // alive long enough to complete the swipe before the list closes its gap.
  useEffect(() => {
    if (present) {
      cardOpacity.set(1);
      void animate(distance, 0, {
        duration: reduceMotion ? 0 : 0.18,
        ease: [0.23, 1, 0.32, 1],
      });
      return;
    }
    const fade = animate(cardOpacity, 0, {
      duration: 0.16,
      ease: [0.23, 1, 0.32, 1],
    });
    const slide = reduceMotion
      ? undefined
      : animate(distance, Math.min(0, distance.get()) - 12, {
          duration: 0.16,
          ease: [0.23, 1, 0.32, 1],
        });
    return () => {
      fade.stop();
      slide?.stop();
    };
  }, [present, reduceMotion, cardOpacity, distance]);

  async function requestDelete() {
    if (await onDelete()) return;
    // A failed local write leaves the note available at its original position.
    void animate(distance, 0, {
      duration: reduceMotion ? 0 : 0.18,
      ease: [0.23, 1, 0.32, 1],
    });
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setArmed(false);
    if (
      !cancelled &&
      active.dragging &&
      active.armed &&
      active.direction === -1
    ) {
      void requestDelete();
      return;
    }
    if (reduceMotion) distance.set(0);
    else
      void animate(distance, 0, { type: "spring", duration: 0.5, bounce: 0.2 });
    if (!cancelled && active.dragging && active.armed) {
      if (active.direction === 1) onEdit();
    }
  }

  return (
    <ContextMenu disabled={disabled || !present}>
      <ContextMenuTrigger
        tabIndex={present ? 0 : -1}
        inert={!present}
        aria-hidden={!present}
        aria-label={
          kind === "note"
            ? "Note; use the context menu to edit or delete"
            : "Highlight; use the context menu to copy or delete"
        }
        className="group relative mb-2 block overflow-x-clip rounded-2xl focus-visible:outline-2 focus-visible:outline-ring"
        data-swipe-ready={armed || undefined}
        data-swipe-action={action}
      >
        {/* Transparent transforms still enlarge scroll bounds. Clip the effect,
            including its resting halo, without clipping the card or its focus ring. */}
        <div className="pointer-events-none absolute inset-0 overflow-x-clip">
          <motion.div
            aria-hidden="true"
            style={{ opacity: present ? opacity : 0, transform: cueTransform }}
            className={`pointer-events-none absolute inset-y-0 flex items-center ${action === "edit" ? "right-0 text-muted-foreground" : "left-0 text-destructive"}`}
          >
            <div className="relative flex size-9 items-center justify-center">
              {action === "edit" ? <Pencil size={16} /> : <Trash2 size={16} />}
              <svg
                viewBox="0 0 36 36"
                className="absolute inset-0 size-9 -rotate-90 fill-none stroke-current"
              >
                <motion.circle
                  cx="18"
                  cy="18"
                  r="16"
                  strokeWidth="1.5"
                  style={{
                    pathLength: progress,
                    opacity: armed && !reduceMotion ? 0 : 1,
                  }}
                />
              </svg>
              {!reduceMotion && (
                <>
                  <motion.span
                    className="absolute inset-0 rounded-full border border-border"
                    style={{ transform: burstTransform, opacity: ringOpacity }}
                  />
                  <motion.span
                    className="absolute inset-0 rounded-full border-[3px] border-border blur-[2px]"
                    style={{ transform: burstTransform, opacity: mistOpacity }}
                  />
                </>
              )}
            </div>
          </motion.div>
        </div>
        <motion.article
          style={{ transform, opacity: cardOpacity, touchAction: "pan-y" }}
          className={`relative rounded-2xl bg-secondary px-4 py-3 group-data-[popup-open]:ring-1 group-data-[popup-open]:ring-ring ${editing ? "ring-1 ring-ring" : ""}`}
          onPointerDown={(event) => {
            suppressClick.current = false;
            if (
              disabled ||
              !event.isPrimary ||
              event.button !== 0 ||
              gesture.current
            )
              return;
            if (
              (event.target as HTMLElement).closest(
                "button,a,textarea,input,[role=menuitem]",
              )
            )
              return;
            if (window.getSelection()?.toString()) return;
            distance.stop();
            distance.set(0);
            gesture.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              dragging: false,
              direction: 1,
              armed: false,
            };
          }}
          onPointerMove={(event) => {
            const active = gesture.current;
            if (!active || active.id !== event.pointerId) return;
            const dx = active.x - event.clientX;
            const dy = Math.abs(event.clientY - active.y);
            if (!active.dragging) {
              if (dy > 10 && dy >= Math.abs(dx)) {
                gesture.current = null;
                return;
              }
              if (Math.abs(dx) < 10 || Math.abs(dx) < dy * 1.5) return;
              if (dx > 0 && !canEdit) {
                gesture.current = null;
                return;
              }
              if (window.getSelection()?.toString()) {
                gesture.current = null;
                return;
              }
              active.direction = Math.sign(dx);
              setAction(dx > 0 ? "edit" : "delete");
              active.dragging = true;
              suppressClick.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            event.preventDefault();
            event.stopPropagation();
            // Lock the action for this touch; crossing the origin only disarms it.
            const travel = Math.max(0, dx * active.direction);
            distance.set(
              active.direction *
                (travel > THRESHOLD
                  ? THRESHOLD + (travel - THRESHOLD) * 0.2
                  : travel),
            );
            const nextArmed = travel >= THRESHOLD;
            if (nextArmed !== active.armed) {
              active.armed = nextArmed;
              setArmed(nextArmed);
              burst.stop();
              if (nextArmed && !reduceMotion) {
                burst.set(0);
                // A quick expansion with a longer diffuse tail, as requested.
                void animate(burst, 1, {
                  duration: 0.45,
                  ease: "linear",
                });
              } else burst.set(1);
            }
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => {
            // Moving implicit touch capture from a child to this card also bubbles here.
            if (event.target === event.currentTarget) finish(event, true);
          }}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          {children}
        </motion.article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {kind === "note" && (
          <ContextMenuItem disabled={disabled || !canEdit} onClick={onEdit}>
            <Pencil size={14} />
            Edit note
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={disabled}
          onClick={() => void copyEntryText(text)}
        >
          <Copy size={14} />
          Copy text
        </ContextMenuItem>
        <ContextMenuItem
          disabled={disabled}
          variant="destructive"
          onClick={() => void requestDelete()}
        >
          <Trash2 size={14} />
          {kind === "note" ? "Delete note" : "Delete highlight"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
