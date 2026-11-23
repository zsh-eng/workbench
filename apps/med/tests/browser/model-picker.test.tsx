import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { ModelPicker } from "../../src/web/components/ModelPicker";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

const AGENTS = {
  claude: [
    { value: "opus", name: "Opus 5.5" },
    { value: "haiku", name: "Haiku 5.5" },
  ],
  pi: [
    { value: "google/gemini-3-pro", name: "Gemini 3 Pro", group: "Google" },
    { value: "openai-codex/gpt-5.4", name: "GPT-5.4", group: "ChatGPT" },
  ],
  opencode: [],
};

/** The new thread page's picker: the agents, then the chosen one's models. */
function mountPicker() {
  initializeTheme();
  const chosen: string[] = [];
  mount = document.createElement("div");
  mount.style.cssText = "display: flex; justify-content: flex-end; padding: 200px 40px";
  document.body.append(mount);
  root = createRoot(mount);
  function Harness() {
    const [agent, setAgent] = useState<keyof typeof AGENTS>("claude");
    const models = AGENTS[agent];
    const [model, setModel] = useState("opus");
    return (
      <ModelPicker
        models={models}
        model={models.some((entry) => entry.value === model) ? model : (models[0]?.value ?? "")}
        placeholder={agent === "opencode" ? "OpenCode" : undefined}
        onModel={(value) => {
          chosen.push(value);
          setModel(value);
        }}
        agents={{
          value: agent,
          options: [
            { value: "claude", label: "Claude Code" },
            { value: "pi", label: "Pi" },
            { value: "opencode", label: "OpenCode" },
          ],
          onChange: (value) => setAgent(value as keyof typeof AGENTS),
        }}
      />
    );
  }
  root.render(<Harness />);
  return chosen;
}

test("on the new thread page, the agents come first in the picker; each shows its own models", async () => {
  mountPicker();
  const trigger = page.getByRole("combobox", { name: "Model", exact: true });
  await userEvent.click(trigger);
  const panel = page.getByRole("dialog", { name: "Model" });
  const agents = panel.getByRole("group", { name: "Agent" });
  await expect
    .element(agents.getByRole("button", { name: "Claude Code" }))
    .toHaveAttribute("aria-pressed", "true");
  // A model without levels has no row of them.
  expect(panel.getByRole("radiogroup").query()).toBeNull();
  // Another agent's models, in its sections; the search keeps its focus.
  await agents.getByRole("button", { name: "Pi" }).click();
  await expect.element(panel.getByRole("group", { name: "ChatGPT" })).toBeVisible();
  await expect.element(trigger).toHaveTextContent("Gemini 3 Pro");
  await expect.element(panel.getByRole("combobox", { name: "Search models" })).toHaveFocus();
  // An agent that has told no models yet: its name, and no search.
  await agents.getByRole("button", { name: "OpenCode" }).click();
  await expect.element(trigger).toHaveTextContent("OpenCode");
  expect(panel.getByRole("combobox", { name: "Search models" }).query()).toBeNull();
  expect(panel.getByRole("option").elements()).toHaveLength(0);
});
