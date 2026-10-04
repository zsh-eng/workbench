import {
  AnimatePresence,
  LayoutGroup,
  motion,
  MotionConfig,
} from "motion/react";
import {
  ArrowLeft,
  Info,
  Monitor,
  RotateCcw,
  Smartphone,
  TextSelect,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { DesktopFrame, PhoneFrame, type LabDevice } from "./frames";
import { EASE } from "./lab-model";
import { Arc } from "./concepts/Arc";
import { Commonplace } from "./concepts/Commonplace";
import { Interleaf } from "./concepts/Interleaf";
import { Island } from "./concepts/Island";
import { Lift } from "./concepts/Lift";
import { Marginalia } from "./concepts/Marginalia";
import { NotesIsland } from "./concepts/NotesIsland";

interface Concept {
  id: string;
  /** A prototype refines one direction; explorations compare directions. */
  kind: "prototype" | "exploration";
  name: string;
  line: string;
  stages: ("Capture" | "Compose" | "Revisit")[];
  devices: LabDevice[];
  component: ComponentType;
  idea: string;
  steps: string[];
  motion: string[];
  tradeoffs: string[];
}

const CONCEPTS: Concept[] = [
  {
    id: "notes-island",
    kind: "prototype",
    name: "Notes Island",
    line: "Island, refined: it lives in the Reader chrome and stays out of reading.",
    stages: ["Capture", "Compose", "Revisit"],
    devices: ["phone"],
    component: NotesIsland,
    idea: "Island combined with Commonplace and a note peek, inside the real Reader header and footer. The capsule is never shown during plain reading. It replaces the Jot a note button and rides on the footer when the chrome is shown; it rises alone for a selection or a noted passage; it becomes the composer while writing; after saving it confirms and leaves with the chrome. It uses the reading theme's own popover material, so dark themes stay dark. The notebook filters by type and highlight colour, and maps entries on the book ribbon.",
    steps: [
      "Tap the page: the chrome appears and the capsule rides on the footer.",
      "Tap again: both leave. Nothing floats over the text while reading.",
      "Select text: the chrome steps away and the capsule becomes the palette.",
      "Tap a passage with a dot: the capsule shows its note, with Edit and Delete.",
      "Open the notebook from the capsule; filter by type and colour.",
    ],
    motion: [
      "Resting capsule uses the footer's own enter (260 ms) and exit (180 ms) curves.",
      "Other changes of shape use one spring (bounce 0.18, 500 ms).",
      "Writing rides the keyboard on the iOS sheet curve; Undo lives in the capsule.",
    ],
    tradeoffs: [
      "A draft has no indicator while reading; it shows on the capsule with the chrome.",
      "Right alignment suits right thumbs; left-handed readers may want a setting.",
      "Desktop needs its own pattern; a bottom palette is far from the cursor.",
    ],
  },
  {
    id: "interleaf",
    kind: "exploration",
    name: "Interleaf",
    line: "The page parts, and the note is written inside the text.",
    stages: ["Capture", "Compose"],
    devices: ["desktop", "phone"],
    component: Interleaf,
    idea: "A note belongs to the sentence that caused it. Instead of a floating box that covers the page, the text opens below the passage and the reader writes in the gap. After saving, the gap closes into a numbered footnote mark. The page re-paginates, as a real page would.",
    steps: [
      "Select a passage, then choose the pen.",
      "Write. Esc keeps an unsent draft as a hollow mark.",
      "Click a numbered mark to read, edit, or delete.",
      "On desktop, hover a paragraph and use + for a paragraph note.",
    ],
    motion: [
      "Height opens over 440 ms on ease-out-quint; hairlines draw in from opposite edges.",
      "Inset shadows give the gap depth, like a cut in paper.",
      "Footnote marks spring in (bounce 0.32). Draft marks breathe slowly.",
    ],
    tradeoffs: [
      "Inserted content changes pagination; Reader must re-layout the open chapter.",
      "Very long notes push the passage's context off the page.",
    ],
  },
  {
    id: "marginalia",
    kind: "exploration",
    name: "Marginalia",
    line: "Notes are typeset as sidenotes. The margin is the notebook.",
    stages: ["Compose", "Revisit"],
    devices: ["desktop"],
    component: Marginalia,
    idea: "On a wide screen the margin is free space. Notes sit beside their passages as italic sidenotes, like a well-annotated printed book. They do not repeat the quote: position connects them, and hover draws a hairline from the passage. The note being written keeps its place; other notes move away from it. In a narrow window, notes fold into numbered dots in the outer margin, so the composer never covers the text.",
    steps: [
      "Hover a sidenote or its passage to draw the connector.",
      "Select text and choose the pen; the composer opens in the margin.",
      "Move into the empty margin and click to write a paragraph note.",
      "Switch to Narrow in the top bar to see the folded margin.",
    ],
    motion: [
      "Notes resolve collisions with a soft spring (bounce 0.18) when one grows.",
      "The connector draws over 360 ms on ease-out-quint from the gutter dot.",
      "Saving keeps the text in place; only the card border and shadow fade.",
    ],
    tradeoffs: [
      "Needs about 360 px of free margin; below that it uses margin dots.",
      "Notes on the next page leave the margin when the page turns.",
    ],
  },
  {
    id: "island",
    kind: "exploration",
    name: "Island",
    line: "One surface that changes shape for each step of the flow.",
    stages: ["Capture", "Compose", "Revisit"],
    devices: ["phone"],
    component: Island,
    idea: "Today the phone flow uses a chrome button, a colour bar, a composer and a sheet. Island folds them into one floating object. It rests as a small capsule, becomes a palette on selection, a composer above the keyboard, a confirmation after saving, and the notebook itself. Because it is always the same object, the reader always knows where notes live. It uses the opposite reading theme so it reads as an instrument above the page.",
    steps: [
      "Select a passage: the capsule becomes a palette.",
      "Tap a colour, or Note to write with the quote attached.",
      "Tap outside while writing: the draft stays on the capsule.",
      "Tap the count to grow the capsule into the notebook.",
    ],
    motion: [
      "Size and corner radius follow a spring (bounce 0.18, 500 ms).",
      "Content crossfades with a 6 px blur and slight scale.",
      "The capsule rides the keyboard on the iOS sheet curve.",
    ],
    tradeoffs: [
      "An inverted surface is strong; it may need a quieter material.",
      "The notebook is limited to the capsule's width on large phones.",
    ],
  },
  {
    id: "lift",
    kind: "exploration",
    name: "Lift",
    line: "The passage rises into a writing card, then flies into the notebook.",
    stages: ["Capture", "Compose"],
    devices: ["phone", "desktop"],
    component: Lift,
    idea: "Writing a note is a short change of focus. Lift makes it physical: the highlight leaves the page and lands at the top of a card, while the page recedes. Saving sends the card along an arc into the notebook button, which counts it in. The reader sees where the note went, so the notebook stops being an abstract list.",
    steps: [
      "Select a passage and choose the pen.",
      "Change the colour while writing; the lifted strip follows.",
      "Save to send the card into the notebook. Cancel puts the passage back.",
      "Open the notebook from the top right.",
    ],
    motion: [
      "The strip travels on a spring (500 ms) and gains a shadow as it lifts.",
      "The page scales to 94% with a 1.5 px blur while writing.",
      "Flight: 680 ms arc with rotation, ending in a count pop.",
    ],
    tradeoffs: [
      "Modal: the reader cannot scroll the page while writing.",
      "The flight must be skipped for quick repeated notes.",
    ],
  },
  {
    id: "commonplace",
    kind: "exploration",
    name: "Commonplace",
    line: "The notebook as a typeset journal, mapped onto the whole book.",
    stages: ["Revisit"],
    devices: ["desktop", "phone"],
    component: Commonplace,
    idea: "The current notebook reads like a chat log. A commonplace book is closer to what readers keep: quotes set in the book's face with a low highlighter stroke, thoughts below in the reader's voice, chapters as headings. A ribbon above the list shows the whole book, chapter by chapter, with a tick for each entry and a window for what is in view. On desktop the sidebar opens into a full journal for a review session.",
    steps: [
      "Scroll the list and watch the ribbon window follow.",
      "Hover or click a tick to jump to its entry.",
      "Switch order and filters; entries move to their new places.",
      "Click an entry for its context; on desktop, expand to the journal.",
    ],
    motion: [
      "Entries reorder with shared layout springs.",
      "The ribbon window springs between page ranges.",
      "Sidebar to journal: one continuous resize, the heading grows from 24 to 34 px.",
    ],
    tradeoffs: [
      "The ribbon needs page numbers from current pagination.",
      "Context excerpts need canonical chapter text in the notebook query.",
    ],
  },
  {
    id: "arc",
    kind: "exploration",
    name: "Arc",
    line: "Press and hold a sentence; actions fan out under the thumb.",
    stages: ["Capture"],
    devices: ["phone"],
    component: Arc,
    idea: "Selecting text on a phone means dragging small handles. For most notes a sentence is the right unit. Arc selects the sentence under a long press and opens a marking menu around the thumb: four colours and Note. Drag toward an action and release. The directions stay the same, so with practice the gesture becomes a flick.",
    steps: [
      "Press and hold any sentence until the ring completes.",
      "Without lifting, drag toward a colour or the pen, then release.",
      "Release in the centre to keep the menu open for a tap.",
      "Choose the pen to write with the sentence attached.",
    ],
    motion: [
      "A 380 ms hold ring confirms intent before anything changes.",
      "Items fan out with a 25 ms stagger on a snappy spring.",
      "The chosen item blooms and the rest fold back to the thumb.",
    ],
    tradeoffs: [
      "Conflicts with the system long-press selection; needs a setting.",
      "Sentence detection fails on abbreviations and verse.",
    ],
  },
];

const THEMES = [
  { id: "flexoki-light", label: "Flexoki light" },
  { id: "light", label: "Light" },
  { id: "flexoki-dark", label: "Flexoki dark" },
  { id: "dark", label: "Dark" },
  { id: "night", label: "Night" },
];

/**
 * Notes Lab: interactive prototypes for the Reader notetaking flow. All
 * prototype state is in memory and resets per concept, device and theme.
 */
export function NotesLab() {
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const concept =
    CONCEPTS.find((entry) => entry.id === params.get("concept")) ?? CONCEPTS[0];
  const requested = params.get("device") as LabDevice | null;
  const device: LabDevice = mobile
    ? "phone"
    : requested && concept.devices.includes(requested)
      ? requested
      : concept.devices[0];
  const theme =
    THEMES.find((entry) => entry.id === params.get("theme"))?.id ??
    "flexoki-light";
  const [reduced, setReduced] = useState(false);
  const [reset, setReset] = useState(0);
  const [demo, setDemo] = useState(0);
  const [briefOpen, setBriefOpen] = useState(false);
  const Component = concept.component;

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "concept") next.delete("device");
    setParams(next, { replace: true });
    setDemo(0);
    setBriefOpen(false);
  }

  const stage = (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      {device === "desktop" ? (
        <DesktopFrame key={`${concept.id}:${reset}`} theme={theme} demo={demo}>
          <Component />
        </DesktopFrame>
      ) : (
        <PhoneFrame
          key={`${concept.id}:${reset}`}
          theme={theme}
          bare={mobile}
          demo={demo}
        >
          <Component />
        </PhoneFrame>
      )}
    </MotionConfig>
  );

  const resetButton = (
    <button
      type="button"
      aria-label="Reset prototype"
      title="Reset prototype"
      onClick={() => {
        setDemo(0);
        setReset((value) => value + 1);
      }}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border hover:bg-secondary"
    >
      <RotateCcw className="size-3.5" />
    </button>
  );

  const controls = (
    <div className="flex items-center gap-2">
      {!mobile && concept.devices.length > 1 && (
        <Segmented
          value={device}
          options={concept.devices.map((value) => ({
            value,
            label: value === "desktop" ? "Desktop" : "Phone",
            icon: value === "desktop" ? Monitor : Smartphone,
          }))}
          onChange={(value) => set("device", value)}
        />
      )}
      <button
        type="button"
        onClick={() => setDemo((value) => value + 1)}
        className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium hover:bg-secondary"
      >
        <TextSelect className="size-3.5" />
        {mobile ? "Select text" : "Select a passage"}
      </button>
      {!mobile && resetButton}
      <div className="ml-auto flex items-center gap-3">
        <ThemePicker value={theme} onChange={(value) => set("theme", value)} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={reduced}
            onCheckedChange={setReduced}
            aria-label="Reduce motion"
          />
          {!mobile && "Reduce motion"}
        </label>
      </div>
    </div>
  );

  if (mobile)
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        <header className="shrink-0 border-b border-border px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2.5">
          <div className="flex items-center gap-2">
            <Link
              to="/settings"
              aria-label="Back to settings"
              className="-ml-1 flex size-8 items-center justify-center rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="flex-1 text-sm font-semibold">Notes Lab</h1>
            <button
              type="button"
              aria-expanded={briefOpen}
              onClick={() => setBriefOpen((value) => !value)}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium aria-expanded:bg-foreground aria-expanded:text-background"
            >
              <Info className="size-3.5" />
              About
            </button>
            {resetButton}
          </div>
          <ConceptChips
            value={concept.id}
            onChange={(id) => set("concept", id)}
          />
          <div className="mt-2">{controls}</div>
        </header>
        <div className="relative min-h-0 flex-1">
          {stage}
          <AnimatePresence>
            {briefOpen && (
              <motion.div
                key={concept.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.24, ease: EASE }}
                className="absolute inset-0 z-[80] overflow-y-auto bg-background pb-[env(safe-area-inset-bottom)]"
              >
                <Brief concept={concept} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-border/70">
        <div className="px-6 pt-6 pb-4">
          <Link
            to="/settings"
            className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Settings
          </Link>
          <h1
            className="text-[28px] leading-tight"
            style={{ fontFamily: "Lora, serif" }}
          >
            Notes Lab
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            One refined prototype and six explorations of how a reader captures,
            writes and revisits notes. Nothing here touches your library.
          </p>
        </div>
        <LayoutGroup>
          <nav aria-label="Concepts" className="px-3">
            {(["prototype", "exploration"] as const).map((kind) => (
              <div key={kind} className="mb-3">
                <h2 className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {kind === "prototype" ? "Prototype" : "Explorations"}
                </h2>
                {CONCEPTS.filter((entry) => entry.kind === kind).map(
                  (entry, index) => (
                    <ConceptLink
                      key={entry.id}
                      concept={entry}
                      number={
                        kind === "prototype"
                          ? "P"
                          : String(index + 1).padStart(2, "0")
                      }
                      active={entry.id === concept.id}
                      onSelect={() => set("concept", entry.id)}
                    />
                  ),
                )}
              </div>
            ))}
          </nav>
        </LayoutGroup>
        <Brief concept={concept} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        {controls}
        <div className="min-h-0 flex-1">{stage}</div>
      </main>
    </div>
  );
}

function ConceptLink({
  concept,
  number,
  active,
  onSelect,
}: {
  concept: Concept;
  number: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className="group relative block w-full rounded-2xl px-3 py-3 text-left"
    >
      {active && (
        <motion.span
          layoutId="concept-active"
          transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
          className="absolute inset-0 rounded-2xl bg-secondary"
        />
      )}
      <span className="relative flex items-baseline gap-3">
        <span className="w-4 font-numeric text-[11px] text-muted-foreground tabular-nums">
          {number}
        </span>
        <span className="flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            {concept.name}
            <span className="flex gap-1 text-muted-foreground">
              {concept.devices.includes("desktop") && (
                <Monitor className="size-3" />
              )}
              {concept.devices.includes("phone") && (
                <Smartphone className="size-3" />
              )}
            </span>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {concept.line}
          </span>
        </span>
      </span>
    </button>
  );
}

function Brief({ concept }: { concept: Concept }) {
  return (
    <motion.section
      key={concept.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="space-y-5 px-6 py-6 text-[13px] leading-relaxed"
    >
      <div className="flex flex-wrap gap-1.5">
        {concept.stages.map((stage) => (
          <span
            key={stage}
            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
          >
            {stage}
          </span>
        ))}
      </div>
      <p className="text-foreground/90">{concept.idea}</p>
      <BriefList title="Try it" items={concept.steps} ordered />
      <BriefList title="Motion" items={concept.motion} />
      <BriefList title="Trade-offs" items={concept.tradeoffs} />
    </motion.section>
  );
}

function BriefList({
  title,
  items,
  ordered,
}: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      <List
        className={cn(
          "space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/60",
          ordered ? "list-decimal" : "list-disc",
        )}
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </div>
  );
}

function ConceptChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
      {CONCEPTS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onChange(entry.id)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
            entry.id === value
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground",
          )}
        >
          {entry.name}
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: {
    value: T;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex h-8 items-center rounded-full border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className="relative flex h-full items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground aria-pressed:text-foreground"
        >
          {option.value === value && (
            <motion.span
              layoutId="device-active"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              className="absolute inset-0 rounded-full bg-secondary"
            />
          )}
          <option.icon className="relative size-3.5" />
          <span className="relative">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reading theme"
      className="flex items-center gap-2 md:gap-1.5"
    >
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={theme.id === value}
          aria-label={theme.label}
          title={theme.label}
          onClick={() => onChange(theme.id)}
          className={cn(
            "relative size-5 rounded-full ring-offset-2 ring-offset-background transition-shadow md:size-6",
            theme.id === value
              ? "ring-2 ring-foreground/60"
              : "ring-1 ring-border",
          )}
        >
          <span
            className={cn(
              theme.id,
              "absolute inset-0 overflow-hidden rounded-full bg-background",
            )}
          >
            <span className="absolute inset-y-0 right-0 w-1/2 bg-foreground/85" />
          </span>
        </button>
      ))}
    </div>
  );
}
