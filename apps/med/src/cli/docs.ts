import vaults from "../../docs/VAULTS.md" with { type: "text" };
import reference from "../../docs/AGENT_INTEGRATION.md" with { type: "text" };
import usage from "../../docs/USAGE.md" with { type: "text" };
import agents from "../../skills/med/guide.md" with { type: "text" };

/** Embed the version-matched guides so terminal docs need neither a host nor a checkout. */
export function runDocsCommand(args: string[], print: (text: string) => void = console.log) {
  // agents: the guide for agents, which the skill installs too; reference: the whole contract.
  const topics: Record<string, string> = { vaults, agents, usage, reference };
  if (!args.length || args[0] === "--help") {
    print(
      "Usage: med-diff docs <agents|usage|vaults|reference>\nPrint an embedded guide as Markdown. Works offline.\nagents is the guide for agents; reference is the full agent integration reference.",
    );
    return;
  }
  if (args.length !== 1 || !Object.hasOwn(topics, args[0]!))
    throw new Error("Choose docs agents, docs usage, docs vaults, or docs reference.");
  print(topics[args[0]!]!.trimEnd());
}
