import vaults from "../../docs/VAULTS.md" with { type: "text" };
import reference from "../../docs/AGENT_INTEGRATION.md" with { type: "text" };
import usage from "../../docs/USAGE.md" with { type: "text" };
import agents from "../../skills/med/guide.md" with { type: "text" };

/** Embed the version-matched guides so terminal docs need neither a host nor a checkout. */
export function runDocsCommand(args: string[], print: (text: string) => void = console.log) {
  // agents: the guide for agents, which the skill installs too; reference: the whole contract.
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
