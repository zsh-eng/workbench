import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";

type TooltipSide = "bottom" | "inline-start";

/**
 * The attributes that give a control the app's tooltip. One popup,
 * `AppTooltip`, serves all controls, so a control renders no tooltip parts
 * and a toolbar renders again as fast as its buttons.
 */
export function tooltip(label: string | undefined, shortcut?: string, side?: TooltipSide) {
  if (!label) return {};
  return {
    "data-tooltip": label,
    "data-tooltip-keys": shortcut,
    // Beside a menu's item, the tooltip goes to its side, off the items below.
    "data-tooltip-side": side,
  };
}

/** The delays of Base UI's tooltip provider: the pointer rests, the tooltip
 * closes, and after it closes, the next one opens at once for a time. */
const REST_MS = 400;
const CLOSE_MS = 80;
const GROUP_MS = 500;

interface Tip {
  anchor: Element;
  label: string;
  shortcut?: string;
  side: TooltipSide;
  /** No transition: in a delay group, for a key, or for a dismissal. */
  instant?: "delay" | "focus" | "dismiss";
}

const readTip = (element: Element, instant?: Tip["instant"]): Tip => ({
  anchor: element,
  label: element.getAttribute("data-tooltip") ?? "",
  shortcut: element.getAttribute("data-tooltip-keys") ?? undefined,
  side: element.getAttribute("data-tooltip-side") === "inline-start" ? "inline-start" : "bottom",
  instant,
});

/** The control with a tooltip that an event is on. */
const triggerOf = (event: Event) => {
  const target = event.composedPath().find((node) => node instanceof Element);
  const trigger = target instanceof Element ? target.closest("[data-tooltip]") : null;
  return trigger?.getAttribute("data-tooltip") ? trigger : null;
};

/**
 * The app's one tooltip. It follows the pointer and the keyboard focus over
 * controls with `tooltip()` attributes, as Base UI's tooltip triggers did:
 * it opens when the pointer rests on a control, at once while another
 * tooltip shows or just closed, and at once on keyboard focus. A press or
 * Escape closes it, and a pressed control shows none until the pointer
 * leaves it.
 */
export function AppTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const close = useRef<(instant?: Tip["instant"]) => void>(() => {});
  useEffect(() => {
    let hovered: Element | null = null;
    let focused: Element | null = null;
    let shown: Element | null = null;
    let pressed: Element | null = null;
    // Focus that comes back with the window opens no tooltip.
    let refocus = false;
    let groupUntil = 0;
    let resting: Element | null = null;
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let watch: MutationObserver | undefined;
    const stopRest = () => {
      clearTimeout(restTimer);
      resting = null;
    };
    const show = (trigger: Element, instant?: Tip["instant"]) => {
      stopRest();
      clearTimeout(closeTimer);
      if (shown === trigger && !instant) return;
      shown = trigger;
      setTip(readTip(trigger, instant));
      setOpen(true);
      // The control can leave the page, or change its label, while it shows.
      watch?.disconnect();
      watch = new MutationObserver(() => {
        if (!shown) return;
        if (!shown.isConnected || !shown.getAttribute("data-tooltip")) hide("dismiss");
        else
          setTip((current) =>
            current && shown && current.anchor === shown
              ? readTip(shown, current.instant)
              : current,
          );
      });
      watch.observe(document.body, { childList: true, subtree: true });
      watch.observe(trigger, {
        attributes: true,
        attributeFilter: ["data-tooltip", "data-tooltip-keys"],
      });
    };
    const hide = (instant?: Tip["instant"]) => {
      stopRest();
      clearTimeout(closeTimer);
      watch?.disconnect();
      watch = undefined;
      if (!shown) return;
      shown = null;
      groupUntil = performance.now() + GROUP_MS;
      setTip((current) => current && { ...current, instant });
      setOpen(false);
    };
    close.current = hide;
    const later = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => hide(), CLOSE_MS);
    };
    const rest = (trigger: Element) => {
      stopRest();
      resting = trigger;
      restTimer = setTimeout(() => show(trigger), REST_MS);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (popup.current?.contains(event.target as Node)) return clearTimeout(closeTimer);
      const trigger = triggerOf(event);
      if (trigger === hovered) return;
      hovered = trigger;
      if (pressed !== trigger) pressed = null;
      stopRest();
      if (!trigger) {
        // A tooltip that a key opened stays while its control has the focus.
        if (shown && shown !== focused) later();
        return;
      }
      // From a tooltip that the pointer opened, the next opens at once.
      if (shown && shown !== focused) show(trigger, "delay");
    };
    // Other tooltips start when the pointer moves on their control. Just
    // after a tooltip closed, one opens at once if the pointer moved, not for
    // a control that moved under a still pointer; else it opens when the
    // pointer rests: as in Base UI, a move of less than a pixel keeps the wait.
    const move = (event: PointerEvent) => {
      if (!hovered || shown === hovered || hovered === pressed) return;
      const moved = event.movementX ** 2 + event.movementY ** 2 >= 2;
      if (moved && performance.now() < groupUntil) show(hovered, "delay");
      else if (moved || resting !== hovered) rest(hovered);
    };
    const out = (event: PointerEvent) => {
      // The pointer left the window.
      if (event.relatedTarget || !hovered) return;
      hovered = null;
      pressed = null;
      stopRest();
      if (shown && shown !== focused) later();
    };
    const press = (event: PointerEvent) => {
      const trigger = triggerOf(event);
      if (!trigger) return;
      pressed = trigger;
      hide("dismiss");
      stopRest();
    };
    const focus = (event: FocusEvent) => {
      const trigger = triggerOf(event);
      focused = trigger;
      if (refocus) refocus = false;
      else if (trigger && trigger !== pressed && trigger.matches(":focus-visible"))
        show(trigger, "focus");
    };
    const blur = (event: FocusEvent) => {
      if (!focused || triggerOf(event) !== focused) return;
      if (shown === focused) hide();
      focused = null;
    };
    const away = () => {
      refocus = !!focused;
      if (shown === focused) hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide("dismiss");
    };
    const options = { capture: true, passive: true } as const;
    const listeners = [
      ["pointerover", over],
      ["pointermove", move],
      ["pointerout", out],
      ["pointerdown", press],
      ["focusin", focus],
      ["focusout", blur],
      ["keydown", key],
    ] as const;
    for (const [type, listener] of listeners)
      document.addEventListener(type, listener as EventListener, options);
    window.addEventListener("blur", away);
    return () => {
      hide();
      for (const [type, listener] of listeners)
        document.removeEventListener(type, listener as EventListener, options);
      window.removeEventListener("blur", away);
    };
  }, []);
  return (
    <Tooltip.Root
      open={open && !!tip}
      onOpenChange={(next, details) => {
        if (!next) close.current(details.reason === "escape-key" ? "dismiss" : undefined);
      }}
    >
      <Tooltip.Portal>
        <Tooltip.Positioner
          anchor={tip?.anchor}
          side={tip?.side ?? "bottom"}
          sideOffset={6}
          {...stylex.props(styles.positioner)}
        >
          <Tooltip.Popup
            ref={popup}
            role="tooltip"
            data-instant={tip?.instant}
            {...stylex.props(styles.popup, ui.pop)}
          >
            <span>{tip?.label}</span>
            <ShortcutKeys value={tip?.shortcut} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ToolButton({
  label,
  shortcut,
  icon,
  active,
  busy,
  dot,
  ...props
}: Omit<ComponentProps<"button">, "children" | "title"> & {
  label: string;
  shortcut?: string;
  icon: IconName;
  active?: boolean;
  /** Turn the icon while this button's own request is running. */
  busy?: boolean;
  /** A small accent dot at the icon's corner: something behind this control
   * needs the reader. The label says what. */
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      {...stylex.props(ui.button, ui.iconButton, ui.pressable, active && ui.active)}
      {...props}
      {...tooltip(label, shortcut)}
      data-med-tool-button=""
      aria-label={props["aria-label"] ?? label}
    >
      <span {...stylex.props(styles.icon, busy && styles.spinning)}>
        <Icon name={icon} size={15} />
        {dot && <span data-dot="" aria-hidden="true" {...stylex.props(styles.dot)} />}
      </span>
    </button>
  );
}
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  icon: { position: "relative", display: "inline-flex" },
  // On the icon's top right corner, cut from it by a ring of the panel's colour.
  dot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    boxShadow: `0 0 0 1.5px ${tokens.panel}`,
  },
  spinning: {
    animationName: { default: spin, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "800ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  positioner: { zIndex: 150 },
  popup: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: "min(320px, 90vw)",
    overflowWrap: "anywhere",
    whiteSpace: "pre-line",
    paddingBlock: 5,
    paddingInlineStart: 8,
    paddingInlineEnd: 6,
    minHeight: 28,
    boxSizing: "border-box",
    borderRadius: `calc(7px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    backgroundColor: tokens.raised,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
});
