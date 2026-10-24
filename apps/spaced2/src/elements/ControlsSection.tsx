import BouncyButton from "@/components/bouncy-button";
import CurrentCardBadge from "@/components/current-card-badge";
import NavButton from "@/components/nav/nav-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDemoPlayer } from "@workbench/elements/react";
import {
  Book,
  Bookmark,
  Home,
  Plus,
  Telescope,
  Trash,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { State } from "ts-fsrs";
import { CARD_SAMPLES, sampleCard } from "./card-fixture";
import { DemoControls } from "./DemoControls";
import { ElementsSection } from "./ElementsLayout";
import { prefersReducedMotion, useSelection } from "./selection";
import { Specimen } from "./Specimen";

/** One control with the name of the state it shows. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const BUTTON_STATES = [
  { id: "variants", label: "Variants" },
  { id: "sizes", label: "Sizes" },
  { id: "disabled", label: "Disabled" },
  { id: "navigation", label: "Navigation" },
] as const;

function Buttons() {
  const selection = useSelection(BUTTON_STATES);
  return (
    <Specimen
      title="Buttons"
      note="The Button component in each variant and size, and the navigation buttons. Navigation shows Home as the current page; its links stay on this page."
      states={BUTTON_STATES}
      selection={selection}
    >
      <div className="flex flex-wrap items-start gap-6">
        {selection.state === "variants" && (
          <>
            <Cell label="Default">
              <Button>Create</Button>
            </Cell>
            <Cell label="Secondary">
              <Button variant="secondary">Cancel</Button>
            </Cell>
            <Cell label="Outline">
              <Button variant="outline">
                <Upload />
                Import
              </Button>
            </Cell>
            <Cell label="Ghost">
              <Button variant="ghost">Skip</Button>
            </Cell>
            <Cell label="Destructive">
              <Button variant="destructive">
                <Trash />
                Delete
              </Button>
            </Cell>
            <Cell label="Link">
              <Button variant="link">What can I do?</Button>
            </Cell>
          </>
        )}
        {selection.state === "sizes" && (
          <>
            <Cell label="Small">
              <Button size="sm">Save</Button>
            </Cell>
            <Cell label="Default">
              <Button>Save</Button>
            </Cell>
            <Cell label="Large">
              <Button size="lg">Save</Button>
            </Cell>
            <Cell label="Icon">
              <Button size="icon" variant="outline" aria-label="Create">
                <Plus />
              </Button>
            </Cell>
          </>
        )}
        {selection.state === "disabled" && (
          <>
            <Cell label="Default">
              <Button disabled>Create</Button>
            </Cell>
            <Cell label="Outline">
              <Button variant="outline" disabled>
                Import
              </Button>
            </Cell>
            <Cell label="Destructive">
              <Button variant="destructive" disabled>
                Delete
              </Button>
            </Cell>
          </>
        )}
        {selection.state === "navigation" && (
          <div className="flex w-full max-w-md rounded-xl bg-muted dark:bg-background">
            <NavButton label="Decks" icon={<Book />} href="/decks" />
            <NavButton label="Saved" icon={<Bookmark />} href="/saved" />
            <NavButton
              label="Review"
              icon={<Home className="scale-x-110" strokeWidth={2.5} />}
              href="/"
              focused
            />
            <NavButton
              label="Create"
              icon={<Plus strokeWidth={3} />}
              href="/create"
            />
            <NavButton label="Profile" icon={<UserRound />} href="/profile" />
          </div>
        )}
      </div>
    </Specimen>
  );
}

const BOUNCY_STATES = [
  { id: "default", label: "Default" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
] as const;

type BouncyVariant = (typeof BOUNCY_STATES)[number]["id"];

/**
 * Presses the button once after it mounts, then hands it back to the
 * pointer. `pressed` must return to undefined, or the button would release
 * every pointer press at once.
 */
function PressedOnce({
  variant,
  play,
}: {
  variant: BouncyVariant;
  play: boolean;
}) {
  const [pressed, setPressed] = useState<boolean>();
  useEffect(() => {
    if (!play) return;
    const timers = [
      window.setTimeout(() => setPressed(true), 250),
      window.setTimeout(() => setPressed(false), 430),
      window.setTimeout(() => setPressed(undefined), 700),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [play]);
  if (variant === "default")
    return (
      <BouncyButton asButton pressed={pressed}>
        <Telescope className="size-10 text-foreground" strokeWidth={1.8} />
        <span className="sr-only">Spaced</span>
      </BouncyButton>
    );
  if (variant === "medium")
    return (
      <BouncyButton variant="medium" asButton pressed={pressed}>
        <span className="flex h-40 w-32 items-end justify-end rounded-xl border-3 border-background bg-muted-foreground p-3 text-right font-semibold text-white shadow-sm">
          Biology
        </span>
      </BouncyButton>
    );
  return (
    <BouncyButton
      variant="large"
      asButton
      pressed={pressed}
      className="flex h-48 w-52 flex-col items-center justify-center rounded-xl bg-background/50 dark:bg-muted/50"
    >
      <Home className="size-16" />
      <span className="mt-2">Large tile</span>
    </BouncyButton>
  );
}

function Bouncy() {
  const selection = useSelection(BOUNCY_STATES);
  const demo = useDemoPlayer();
  const play =
    demo.state.run > 0 || selection.nonce > 0 || !prefersReducedMotion();
  return (
    <Specimen
      title="Bouncy button"
      note="It squashes on press and overshoots on release; larger variants move less and slower. Replay presses it once, or press it yourself."
      states={BOUNCY_STATES}
      selection={selection}
      controls={<DemoControls demo={demo} label="Bouncy button" />}
      stageRef={demo.stageRef}
      stageProps={demo.stageProps()}
    >
      <div className="grid min-h-52 place-items-center">
        <PressedOnce
          key={`${selection.state}:${selection.nonce}:${demo.state.run}`}
          variant={selection.state as BouncyVariant}
          play={play}
        />
      </div>
    </Specimen>
  );
}

const BADGE_STATES = [
  { id: "card", label: "Card states" },
  { id: "variants", label: "Variants" },
] as const;

const CARD_STATES = [State.New, State.Learning, State.Review, State.Relearning];

function Badges() {
  const selection = useSelection(BADGE_STATES);
  return (
    <Specimen
      title="Badges"
      note="The current card's state above the card, and the Badge variants. The card badge hides below 640 px, as in the app. The queue count badges read the live queue, so they are not shown; they use the dot variant with the same colours."
      states={BADGE_STATES}
      selection={selection}
      surface="card"
    >
      <div className="flex flex-wrap items-center gap-6">
        {selection.state === "card" && (
          <>
            {CARD_STATES.map((state) => (
              <CurrentCardBadge
                key={state}
                card={sampleCard(`badge-${state}`, CARD_SAMPLES.text, state)}
              />
            ))}
            <p className="text-sm text-muted-foreground sm:hidden">
              The app hides these badges at this width.
            </p>
          </>
        )}
        {selection.state === "variants" && (
          <>
            <Cell label="Default">
              <Badge>Default</Badge>
            </Cell>
            <Cell label="Secondary">
              <Badge variant="secondary">Secondary</Badge>
            </Cell>
            <Cell label="Destructive">
              <Badge variant="destructive">Destructive</Badge>
            </Cell>
            <Cell label="Outline">
              <Badge variant="outline">Outline</Badge>
            </Cell>
            <Cell label="Dot">
              <Badge variant="dot" className="h-8 before:bg-blue-500">
                12
              </Badge>
            </Cell>
          </>
        )}
      </div>
    </Specimen>
  );
}

export function ControlsSection() {
  return (
    <ElementsSection
      id="controls"
      title="Controls"
      description="Buttons and badges, from the shared components in components/ui and the app's own parts."
    >
      <Buttons />
      <Bouncy />
      <Badges />
    </ElementsSection>
  );
}
