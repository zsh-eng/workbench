import vaults from "../../docs/VAULTS.md" with { type: "text" };
import agents from "../../docs/AGENT_INTEGRATION.md" with { type: "text" };
import usage from "../../docs/USAGE.md" with { type: "text" };

/** Embed the version-matched guides so terminal docs need neither a host nor a checkout. */
export function runDocsCommand(args: string[]) {
  const topics: Record<string, string> = { vaults, agents, usage };
  if (!args.length || args[0] === "--help") {
    console.log(
      "Usage: med-diff docs <vaults|agents|usage>\nPrint an embedded guide as Markdown. Works offline.",
    );
    return;
  }
  if (args.length !== 1 || !Object.hasOwn(topics, args[0]!))
    throw new Error("Choose docs vaults, docs agents, or docs usage.");
  console.log(topics[args[0]!]!);
}
