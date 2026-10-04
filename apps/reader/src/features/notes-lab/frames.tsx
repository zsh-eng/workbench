import { AnimatePresence, motion } from "motion/react";
import { BatteryFull, Signal, Wifi } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { SAMPLE_SELECTION } from "./lab-content";
import { EASE_SHEET, type LabSelection } from "./lab-model";

export type LabDevice = "desktop" | "phone";

interface LabScreen {
  device: LabDevice;
  /** Full-bleed on a real phone: no bezel, no faux keyboard. */
  bare: boolean;
  screen: RefObject<HTMLDivElement | null>;
  /** Increments when the lab asks the concept to select its sample passage. */
  demo: number;
  theme: string;
}

const LabScreenContext = createContext<LabScreen | null>(null);

/** The positioned, themed screen that concept overlays measure against. */
export function useLabScreen() {
  const value = useContext(LabScreenContext);
  if (!value) throw new Error("Lab concepts render inside a lab frame.");
  return value;
}

/**
 * Page highlight colours resolved on the screen element. Surfaces that invert
 * their own theme still preview the colour a passage will get on the page.
 */
const PAGE_COLOR_VARS = {
  "--page-yellow": "var(--yellow-secondary)",
  "--page-green": "var(--green-secondary)",
  "--page-blue": "var(--blue-secondary)",
  "--page-magenta": "var(--magenta-secondary)",
  "--page-foreground": "var(--foreground)",
} as CSSProperties;

/** The opposite reading theme, for surfaces that float above the page. */
export function invertedTheme(theme: string) {
  if (theme === "flexoki-light") return "flexoki-dark";
  if (theme === "flexoki-dark") return "flexoki-light";
  if (theme === "light") return "dark";
  return "light";
}

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
export const KEYBOARD_HEIGHT = 291;

/** Scales a fixed-size device into the available box without layout reflow. */
function FitScale({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = outer.current;
    if (!element) return;
    const update = () =>
      setBox({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = box.width
    ? Math.min(1, box.width / width, box.height / height)
    : 0;
  return (
    <div ref={outer} className="relative size-full min-h-0 overflow-hidden">
      {/* A motion value, not a CSS transform, so shared layout animations
          inside the device measure in unscaled coordinates. */}
      <motion.div
        className="absolute top-0"
        style={{
          width,
          height,
          left: (box.width - width * scale) / 2,
          top: Math.max(0, (box.height - height * scale) / 2),
          scale,
          originX: 0,
          originY: 0,
          visibility: scale ? "visible" : "hidden",
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function Screen({
  device,
  bare,
  theme,
  demo,
  className,
  style,
  children,
}: {
  device: LabDevice;
  bare: boolean;
  theme: string;
  demo: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const screen = useRef<HTMLDivElement>(null);
  return (
    <LabScreenContext.Provider value={{ device, bare, screen, demo, theme }}>
      <div
        ref={screen}
        data-lab-screen
        data-theme-class={theme}
        className={cn(
          theme,
          "relative isolate overflow-hidden bg-background text-foreground [-webkit-tap-highlight-color:transparent]",
          className,
        )}
        style={{ ...PAGE_COLOR_VARS, ...style }}
      >
        {children}
      </div>
    </LabScreenContext.Provider>
  );
}

export function PhoneFrame({
  theme,
  bare,
  demo,
  children,
}: {
  theme: string;
  bare: boolean;
  demo: number;
  children: ReactNode;
}) {
  if (bare)
    return (
      <Screen
        device="phone"
        bare
        theme={theme}
        demo={demo}
        className="size-full"
        style={
          {
            "--safe-top": "max(12px, env(safe-area-inset-top))",
            "--safe-bottom": "max(12px, env(safe-area-inset-bottom))",
          } as CSSProperties
        }
      >
        {children}
      </Screen>
    );
  return (
    <FitScale width={PHONE.width + 20} height={PHONE.height + 20}>
      <div className="relative size-full rounded-[64px] bg-primary p-[10px] shadow-[0_40px_80px_-24px_color-mix(in_srgb,var(--foreground)_40%,transparent),0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]">
        <Screen
          device="phone"
          bare={false}
          theme={theme}
          demo={demo}
          className="size-full rounded-[54px]"
          style={
            { "--safe-top": "54px", "--safe-bottom": "28px" } as CSSProperties
          }
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] flex h-[54px] items-center justify-between px-9 pt-1 text-[15px] font-semibold text-foreground">
            <span className="font-numeric tabular-nums">9:41</span>
            <span className="flex items-center gap-1.5">
              <Signal className="size-4" strokeWidth={2.5} />
              <Wifi className="size-4" strokeWidth={2.5} />
              <BatteryFull className="size-5" strokeWidth={2} />
            </span>
          </div>
          {children}
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-[60] h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-foreground" />
        </Screen>
        {/* Outside the themed screen, so it keeps the bezel colour in dark themes. */}
        <span className="pointer-events-none absolute top-[21px] left-1/2 z-[70] h-[34px] w-[124px] -translate-x-1/2 rounded-full bg-primary" />
      </div>
    </FitScale>
  );
}

export function DesktopFrame({
  theme,
  demo,
  children,
}: {
  theme: string;
  demo: number;
  children: ReactNode;
}) {
  return (
    <FitScale width={DESKTOP.width} height={DESKTOP.height}>
      <div className="flex size-full flex-col overflow-hidden rounded-[14px] border border-border bg-secondary shadow-[0_40px_90px_-30px_color-mix(in_srgb,var(--foreground)_35%,transparent)]">
        <div className="flex h-9 shrink-0 items-center gap-2 px-4">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="size-3 rounded-full bg-[color-mix(in_srgb,var(--foreground)_16%,transparent)]"
            />
          ))}
          <span className="mx-auto rounded-md bg-background/70 px-24 py-0.5 text-[11px] text-muted-foreground">
            reader.app/reader/alice
          </span>
          <span className="w-12" />
        </div>
        <Screen
          device="desktop"
          bare={false}
          theme={theme}
          demo={demo}
          className="min-h-0 flex-1"
          style={
            { "--safe-top": "0px", "--safe-bottom": "0px" } as CSSProperties
          }
        >
          {children}
        </Screen>
      </div>
    </FitScale>
  );
}

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/**
 * A static iOS-style keyboard so phone frames show real composer geometry.
 * Physical key presses light the matching key with a pop-up preview.
 */
export function FauxKeyboard({ open }: { open: boolean }) {
  const { bare } = useLabScreen();
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout>;
    const onKey = (event: KeyboardEvent) => {
      const key =
        event.key === " "
          ? "space"
          : event.key === "Backspace"
            ? "delete"
            : event.key === "Enter"
              ? "return"
              : event.key.toLowerCase();
      setPressed(key);
      clearTimeout(timer);
      timer = setTimeout(() => setPressed(null), 140);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [open]);
  if (bare) return null;
  const key =
    "relative flex h-[42px] items-center justify-center rounded-[6px] bg-background text-[21px] leading-none text-foreground shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_28%,transparent)] transition-colors duration-75";
  const special =
    "flex h-[42px] items-center justify-center rounded-[6px] bg-[color-mix(in_srgb,var(--foreground)_14%,var(--secondary))] text-[15px] text-foreground shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_28%,transparent)]";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          aria-hidden
          key="keyboard"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ duration: 0.42, ease: EASE_SHEET }}
          className="absolute inset-x-0 bottom-0 z-50 select-none bg-[color-mix(in_srgb,var(--foreground)_6%,var(--secondary))] px-[3px] pb-[34px] font-sans backdrop-blur-xl"
          style={{ height: KEYBOARD_HEIGHT }}
        >
          <div className="flex h-[42px] items-center text-[15px] text-foreground">
            {["the", "it", "and"].map((word, index) => (
              <span
                key={word}
                className={cn(
                  "flex-1 text-center",
                  index > 0 && "border-l border-foreground/15",
                )}
              >
                {word}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-[11px] pt-[3px]">
            {ROWS.map((row, rowIndex) => (
              <div
                key={row}
                className={cn("flex gap-[6px]", rowIndex === 1 && "px-[19px]")}
              >
                {rowIndex === 2 && (
                  <span className={cn(special, "w-[42px]")}>⇧</span>
                )}
                {rowIndex === 2 && <span className="w-[6px]" />}
                {[...row].map((letter) => (
                  <span
                    key={letter}
                    className={cn(
                      key,
                      "flex-1",
                      pressed === letter &&
                        "bg-[color-mix(in_srgb,var(--foreground)_14%,var(--secondary))]",
                    )}
                  >
                    {letter}
                    {pressed === letter && (
                      <span className="absolute -top-[52px] left-1/2 flex h-[54px] w-[46px] -translate-x-1/2 items-start justify-center rounded-[8px] bg-background pt-2 text-[30px] shadow-[0_2px_10px_color-mix(in_srgb,var(--foreground)_25%,transparent)]">
                        {letter}
                      </span>
                    )}
                  </span>
                ))}
                {rowIndex === 2 && <span className="w-[6px]" />}
                {rowIndex === 2 && (
                  <span
                    className={cn(
                      special,
                      "w-[42px]",
                      pressed === "delete" && "bg-background",
                    )}
                  >
                    ⌫
                  </span>
                )}
              </div>
            ))}
            <div className="flex gap-[6px]">
              <span className={cn(special, "w-[88px]")}>123</span>
              <span
                className={cn(
                  key,
                  "flex-1 text-[15px]",
                  pressed === "space" &&
                    "bg-[color-mix(in_srgb,var(--foreground)_14%,var(--secondary))]",
                )}
              >
                space
              </span>
              <span
                className={cn(
                  special,
                  "w-[88px]",
                  pressed === "return" && "bg-background",
                )}
              >
                return
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Keyboard inset applied to docked composers in framed phones. */
export function useKeyboardInset(open: boolean) {
  const { bare, device } = useLabScreen();
  return open && !bare && device === "phone" ? KEYBOARD_HEIGHT : 0;
}

/** Runs when the lab's "Select a passage" control fires. */
export function useSampleSelection(
  onSample: (selection: LabSelection) => void,
  sample: LabSelection = SAMPLE_SELECTION,
) {
  const { demo } = useLabScreen();
  const run = useEffectEvent(() => onSample(sample));
  useEffect(() => {
    if (demo) run();
  }, [demo]);
}
