import vaults from "../../docs/VAULTS.md" with { type: "text" };
import reference from "../../docs/AGENT_INTEGRATION.md" with { type: "text" };
import usageIndex from "../../docs/USAGE.md" with { type: "text" };
import runMed from "../../docs/usage/run-med.md" with { type: "text" };
import threads from "../../docs/usage/threads.md" with { type: "text" };
import reviewChanges from "../../docs/usage/review-changes.md" with { type: "text" };
import savedReviews from "../../docs/usage/saved-reviews.md" with { type: "text" };
import guide from "../../docs/usage/guide.md" with { type: "text" };
import pullRequests from "../../docs/usage/pull-requests.md" with { type: "text" };
import find from "../../docs/usage/find.md" with { type: "text" };
import editFiles from "../../docs/usage/edit-files.md" with { type: "text" };
import markdown from "../../docs/usage/markdown.md" with { type: "text" };
import layout from "../../docs/usage/layout.md" with { type: "text" };
import keyboard from "../../docs/usage/keyboard.md" with { type: "text" };
import limits from "../../docs/usage/limits.md" with { type: "text" };
import agents from "../../skills/med/guide.md" with { type: "text" };

/** Embed the version-matched guides so terminal docs need neither a host nor a checkout. */
export function runDocsCommand(args: string[], print: (text: string) => void = console.log) {
  // agents: the guide for agents, which the skill installs too; reference: the whole contract.
  // usage: the user guide's index, then its pages in the index's order.
  const usage = [
    usageIndex,
    runMed,
    threads,
    reviewChanges,
    savedReviews,
    guide,
    pullRequests,
    find,
    editFiles,
    markdown,
    layout,
    keyboard,
    limits,
  ]
    .map((page) => page.trimEnd())
    .join("\n\n");
  const topics: Record<string, string> = { vaults, agents, usage, reference };
  if (!args.length || args[0] === "--help") {
    print(`Usage: med docs <usage|agents|vaults|reference>

Prints a guide of this version of Med as Markdown. It works offline.
  usage      How to use Med
  agents     The guide for agents that hand off changes
  vaults     Vaults: folders of Markdown notes
  reference  The full reference for agent integration`);
    return;
  }
  if (args.length !== 1 || !Object.hasOwn(topics, args[0]!))
    throw new Error("Choose docs agents, docs usage, docs vaults, or docs reference.");
  print(topics[args[0]!]!.trimEnd());
}
