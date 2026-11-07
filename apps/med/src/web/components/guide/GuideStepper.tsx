import * as stylex from "@stylexjs/stylex";
import type { GuideScope, GuideSection } from "../../data/guide";
import { tokens, ui } from "../../theme.stylex";
import { ActionMenu } from "../Controls";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";

const pad = (value: number) => String(value).padStart(2, "0");
const same = (a: GuideScope, b: GuideScope) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Guide's parts as a stepper in the review's header, where the Guide's
 * rail hides, as beside the session: the previous part, the shown part's name
 * (a menu of all of them), and the next part. The screen keeps three columns.
 */
export function GuideStepper({
  sections,
  since,
  scope,
  onScope,
  onStep,
}: {
  sections: readonly GuideSection[];
  /** Whether "New since you looked" is a part. */
  since: boolean;
  scope: GuideScope;
  onScope(scope: GuideScope): void;
  onStep(delta: number): void;
}) {
  const parts: { scope: GuideScope; label: string }[] = [
    { scope: { kind: "overview" }, label: "Overview" },
    ...(since ? [{ scope: { kind: "since" } as const, label: "New since you looked" }] : []),
    ...sections.map((section) => ({
      scope: { kind: "segment", key: section.key } as const,
      label: `${section.automatic ? "" : `${pad(section.number)} `}${section.title}`,
    })),
  ];
  const index = Math.max(
    0,
    parts.findIndex((part) => same(part.scope, scope)),
  );
  return (
    <span role="group" aria-label="Guide parts" {...stylex.props(styles.stepper)}>
      <button
        type="button"
        aria-label="Previous part"
        disabled={index <= 0}
        onClick={() => onStep(-1)}
        {...tooltip("Previous part", "k")}
        {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.step)}
      >
        <Icon name="chevron" size={13} style={{ transform: "rotate(90deg)" }} />
      </button>
      <ActionMenu
        label="Choose a part"
        align="start"
        trigger={styles.part}
        sections={[
          parts.map((part) => ({
            label: part.label,
            checked: same(part.scope, scope),
            choice: true,
            onClick: () => onScope(part.scope),
          })),
        ]}
      >
        <span data-clip="" {...stylex.props(styles.label)}>
          {parts[index]!.label}
        </span>
      </ActionMenu>
      <button
        type="button"
        aria-label="Next part"
        disabled={index >= parts.length - 1}
        onClick={() => onStep(1)}
        {...tooltip("Next part", "j")}
        {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.step)}
      >
        <Icon name="chevron" size={13} style={{ transform: "rotate(-90deg)" }} />
      </button>
    </span>
  );
}

const styles = stylex.create({
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
    marginInlineEnd: 6,
  },
  step: { flexShrink: 0, width: 24, height: 24, color: tokens.muted },
  part: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    maxWidth: 240,
    height: 26,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "pointer",
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});
