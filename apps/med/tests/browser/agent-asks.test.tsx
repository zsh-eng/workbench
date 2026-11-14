import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { SessionComposer } from "../../src/web/components/session/SessionComposer";
import { EFFORT_NOTE } from "../../src/web/data/owned-session";
import type {
  OwnedAction,
  OwnedPermission,
  OwnedSetting,
  OwnedState,
} from "../../src/shared/owned-session";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

const MODES: OwnedSetting = {
  id: "mode",
  name: "Mode",
  category: "mode",
  value: "default",
  options: [
    { value: "default", name: "Ask" },
    { value: "acceptEdits", name: "Accept edits" },
    { value: "plan", name: "Plan" },
    { value: "auto", name: "Auto" },
    { value: "dontAsk", name: "Don't ask" },
    {
      value: "bypassPermissions",
      name: "Bypass permissions",
      confirm: "Claude Code will edit any file and run any command without asking.",
    },
  ],
  cycle: ["default", "acceptEdits", "plan", "auto"],
};

const MODELS: OwnedSetting = {
  id: "model",
  name: "Model",
  category: "model",
  value: "opus",
  options: [
    {
      value: "default",
      name: "Default (recommended)",
      description: "Sonnet 5.5 · Efficient for routine tasks",
    },
    { value: "opus", name: "Opus 5.5", description: "For complex work and everyday tasks" },
    { value: "haiku", name: "Haiku 5.5", description: "Fastest for quick answers" },
  ],
};

const EFFORTS: OwnedSetting = {
  id: "effort",
  name: "Effort",
  category: "effort",
  value: "high",
  idleOnly: true,
  options: [
    { value: "default", name: "Default effort" },
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
    { value: "xhigh", name: "Extra high" },
    { value: "max", name: "Max" },
  ],
};

const QUESTIONS: OwnedPermission = {
  id: "q-1",
  title: "Claude Code asks",
  options: [
    { id: "answer", name: "Answer", kind: "allow_once" },
    { id: "deny", name: "Skip", kind: "reject_once" },
  ],
  questions: [
    {
      question: "Which format should durations use?",
      header: "Format",
      options: [
        { label: "Short", description: "1h 5m" },
        { label: "Long", description: "1 hour 5 minutes" },
      ],
    },
    {
      question: "Which units can show?",
      header: "Units",
      multiSelect: true,
      options: [{ label: "Hours" }, { label: "Minutes" }, { label: "Seconds" }],
    },
  ],
};

/** A composer for a session that Med runs; `actions` has what it sent. A
 * setting takes its value, as the host's state does. `width` narrows it, as
 * a session pane beside a review. */
function mountComposer(
  permission?: OwnedPermission,
  settings: OwnedSetting[] = [MODES],
  width?: number,
) {
  initializeTheme();
  const actions: OwnedAction[] = [];
  mount = document.createElement("div");
  if (width) mount.style.width = `${width}px`;
  document.body.append(mount);
  root = createRoot(mount);
  function Harness() {
    const [state, setState] = useState<OwnedState>({
      sessionId: "s-1",
      preset: "claude",
      name: "Claude Code",
      status: permission ? "working" : "idle",
      settings,
      commands: [],
      turns: 1,
      ...(permission ? { permission } : {}),
    });
    return (
      <SessionComposer
        agent="claude"
        name="Claude Code"
        drafts={[]}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onSend={() => {}}
        owned={{
          state,
          act: async (action) => {
            actions.push(action);
            if (action.action === "permission")
              setState((now) => ({ ...now, permission: undefined }));
            if (action.action === "setting")
              setState((now) => ({
                ...now,
                settings: now.settings.map((setting) =>
                  setting.id === action.id ? { ...setting, value: action.value } : setting,
                ),
              }));
          },
        }}
      />
    );
  }
  root.render(<Harness />);
  return actions;
}

test("a question's number keys pick its choices, Other takes an answer, and Answer sends them by question", async () => {
  await page.viewport(900, 800);
  const actions = mountComposer(QUESTIONS);
  const card = page.getByRole("group", { name: "Question" });
  await expect.element(card.getByText("Which format should durations use?")).toBeVisible();
  await expect.element(card.getByText("1h 5m")).toBeVisible();
  const answer = card.getByRole("button", { name: "Answer" });
  await expect.element(answer).toBeDisabled();

  // From the composer's empty field, as in the terminal: 2 picks Long, and
  // the next question is current.
  await userEvent.click(page.getByRole("combobox", { name: "Message Claude Code" }));
  await userEvent.keyboard("2");
  const format = card.getByRole("group", { name: "Which format should durations use?" });
  await expect
    .element(format.getByRole("button", { name: /Long/ }))
    .toHaveAttribute("aria-pressed", "true");
  expect(
    (page.getByRole("combobox", { name: "Message Claude Code" }).element() as HTMLTextAreaElement)
      .value,
  ).toBe("");
  // A multiple choice takes several; 4 goes to Other.
  await userEvent.keyboard("13");
  const units = card.getByRole("group", { name: "Which units can show?" });
  await expect
    .element(units.getByRole("button", { name: /Hours/ }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(units.getByRole("button", { name: /Seconds/ }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("4");
  await expect.element(units.getByRole("textbox", { name: /Other answer/ })).toHaveFocus();
  await userEvent.keyboard("Days");
  await expect.element(answer).toBeEnabled();
  await userEvent.click(answer);
  await expect.element(card).not.toBeInTheDocument();
  expect(actions).toEqual([
    {
      action: "permission",
      id: "q-1",
      option: "answer",
      answers: {
        "Which format should durations use?": "Long",
        "Which units can show?": "Hours, Seconds, Days",
      },
    },
  ]);
});

test("one question with one answer goes when it is picked; Other with Enter answers too", async () => {
  await page.viewport(900, 800);
  const single = { ...QUESTIONS, questions: [QUESTIONS.questions![0]!] };
  const actions = mountComposer(single);
  const card = page.getByRole("group", { name: "Question" });
  await expect.element(card.getByRole("button", { name: "Answer" })).not.toBeInTheDocument();
  await userEvent.click(card.getByRole("button", { name: /Short/ }));
  expect(actions.at(-1)).toEqual({
    action: "permission",
    id: "q-1",
    option: "answer",
    answers: { "Which format should durations use?": "Short" },
  });
  root?.unmount();
  mount?.remove();

  const again = mountComposer(single);
  const other = page.getByRole("textbox", { name: /Other answer/ });
  await userEvent.click(other);
  await userEvent.keyboard("ISO 8601{Enter}");
  expect(again.at(-1)).toEqual({
    action: "permission",
    id: "q-1",
    option: "answer",
    answers: { "Which format should durations use?": "ISO 8601" },
  });
});

test("a plan shows as Markdown; Approve names the mode to continue in, and Keep planning says what to change", async () => {
  await page.viewport(900, 800);
  const plan: OwnedPermission = {
    id: "p-1",
    title: "Claude Code's plan",
    options: [
      { id: "approve", name: "Approve", kind: "allow_once" },
      { id: "deny", name: "Keep planning", kind: "reject_once" },
    ],
    plan: {
      text: "# Format durations\n\n1. Add `formatDuration`.\n2. Test the hour.\n",
      modes: [
        { value: "acceptEdits", name: "Accept edits" },
        { value: "default", name: "Ask" },
        { value: "auto", name: "Auto" },
      ],
      mode: "acceptEdits",
    },
  };
  const actions = mountComposer(plan);
  const card = page.getByRole("group", { name: "Plan" });
  await expect
    .element(card.getByRole("heading", { name: "Format durations" }), { timeout: 5000 })
    .toBeVisible();
  await expect.element(card.getByRole("listitem").first()).toHaveTextContent("Add formatDuration.");
  await userEvent.click(card.getByRole("combobox", { name: "Mode after the plan" }));
  await userEvent.click(page.getByRole("option", { name: "Auto" }));
  await userEvent.click(card.getByRole("button", { name: "Approve" }));
  expect(actions.at(-1)).toEqual({
    action: "permission",
    id: "p-1",
    option: "approve",
    mode: "auto",
  });
  root?.unmount();
  mount?.remove();

  const again = mountComposer(plan);
  const second = page.getByRole("group", { name: "Plan" });
  await userEvent.click(second.getByRole("button", { name: "Keep planning" }));
  const field = second.getByRole("textbox", { name: "What should change" });
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("Test minutes too.{Enter}");
  expect(again.at(-1)).toEqual({
    action: "permission",
    id: "p-1",
    option: "deny",
    message: "Test minutes too.",
  });
});

test("⇧Tab in the message field steps through the modes, and Bypass asks first", async () => {
  await page.viewport(900, 800);
  const actions = mountComposer();
  const field = page.getByRole("combobox", { name: "Message Claude Code" });
  const picker = page.getByRole("combobox", { name: "Mode" });
  await userEvent.click(field);
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(picker).toHaveTextContent("Accept edits");
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Shift>}{Tab}{/Shift}");
  await expect.element(picker).toHaveTextContent("Auto");
  await expect.element(field).toHaveFocus();
  // After the last mode, the cycle starts again.
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(picker).toHaveTextContent("Ask");
  expect(actions.map((action) => action.action === "setting" && action.value)).toEqual([
    "acceptEdits",
    "plan",
    "auto",
    "default",
  ]);

  // Bypass asks first; Cancel keeps the mode.
  await userEvent.click(picker);
  await userEvent.click(page.getByRole("option", { name: /Bypass permissions/ }));
  const confirm = page.getByRole("alertdialog", { name: "Bypass permissions?" });
  await expect.element(confirm.getByText(/edit any file and run any command/)).toBeVisible();
  await expect.element(confirm.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(confirm).not.toBeInTheDocument();
  expect(actions).toHaveLength(4);
  await userEvent.click(picker);
  await userEvent.click(page.getByRole("option", { name: /Bypass permissions/ }));
  await userEvent.click(
    page
      .getByRole("alertdialog", { name: "Bypass permissions?" })
      .getByRole("button", { name: "Bypass permissions" }),
  );
  await expect.element(picker).toHaveTextContent("Bypass permissions");
  expect(actions.at(-1)).toEqual({ action: "setting", id: "mode", value: "bypassPermissions" });
});

test("the pickers' menus open from their trigger's right edge, with the check at the row's end", async () => {
  // A session pane at the window's left, with room on both sides of each
  // picker: the menu could open either way.
  await page.viewport(1200, 800);
  const actions = mountComposer(undefined, [MODELS, EFFORTS, MODES], 560);
  const box = (element: Element) => element.getBoundingClientRect();
  for (const name of ["Model", "Effort", "Mode"]) {
    const picker = page.getByRole("combobox", { name, exact: true });
    await userEvent.click(picker);
    const list = page.getByRole("listbox");
    await expect.element(list).toBeVisible();
    // The popup around the list ends where its trigger ends, once it has
    // grown in.
    const popup = list.element().parentElement!;
    await expect
      .poll(() => Math.abs(box(popup).right - box(picker.element()).right))
      .toBeLessThan(1);
    // The chosen row's check is the row's last thing, at its end.
    const chosen = list.getByRole("option", { selected: true }).element();
    const check = chosen.querySelector("[data-check]")!;
    expect(check.querySelector("svg")).not.toBeNull();
    expect(box(chosen).right - box(check).right).toBeLessThanOrEqual(11);
    expect(box(check).left).toBeGreaterThan(box(chosen).left + box(chosen).width / 2);
    await userEvent.keyboard("{Escape}");
    await expect.element(list).not.toBeInTheDocument();
  }

  // The model that Claude Code recommends shows the mark as a badge, not in
  // its name; the trigger shows the chosen model.
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect.element(model).toHaveTextContent("Opus 5.5");
  await userEvent.click(model);
  const recommended = page.getByRole("option", { name: /^Default/ });
  await expect.element(recommended.getByText("Recommended", { exact: true })).toBeVisible();
  await expect.element(recommended).not.toHaveTextContent("(recommended)");
  await userEvent.keyboard("{Escape}");

  // The effort's menu says first what more effort trades. From the
  // keyboard: the trigger opens it, a letter moves to its choice, and Enter
  // chooses.
  const effort = page.getByRole("combobox", { name: "Effort", exact: true });
  effort.element().focus();
  await userEvent.keyboard("{ArrowDown}");
  const list = page.getByRole("listbox");
  await expect.element(list).toHaveAccessibleDescription(EFFORT_NOTE);
  await expect.element(list.getByRole("option", { name: "High", selected: true })).toBeVisible();
  await userEvent.keyboard("l");
  await expect
    .element(list.getByRole("option", { name: "Low" }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{Enter}");
  await expect.element(list).not.toBeInTheDocument();
  expect(actions.at(-1)).toEqual({ action: "setting", id: "effort", value: "low" });
  await expect.element(effort).toHaveTextContent("Low");
  await expect.element(effort).toHaveFocus();
});

test("at a narrow window's edge, a picker's menu stays in the window", async () => {
  await page.viewport(360, 700);
  mountComposer(undefined, [MODELS, EFFORTS, MODES]);
  await userEvent.click(page.getByRole("combobox", { name: "Model", exact: true }));
  const popup = page.getByRole("listbox").element().parentElement!;
  await expect.poll(() => popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
});
