import { join } from "node:path";
import { parseArgs } from "node:util";
import { listHolders, stopHolder } from "../host/held-agent";
import { getStateDirectory } from "../host/runtime/connection";

export const agentsHelp = `Usage: med agents                      List the agents that keep working without the server
       med agents stop <session> | --all  Stop one agent, or all of them
Options: --state-dir <directory>, --json

Each agent that Med starts runs in a holder of its own, so it goes on while
Med restarts, updates, or stops, and after its tab closes.`;

const age = (since: number) => {
  const minutes = Math.round((Date.now() - since) / 60_000);
  return minutes < 60
    ? `${minutes} min`
    : minutes < 48 * 60
      ? `${Math.round(minutes / 60)} h`
      : `${Math.round(minutes / 1440)} d`;
};

/** `med agents`: the agents' holders, read from their files, so it works
 * while the server is down. */
export async function runAgentsCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "state-dir": { type: "string" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(agentsHelp);
    return;
  }
  const directory = join(getStateDirectory(values["state-dir"]), "agents");
  const holders = await listHolders(directory);
  if (positionals[0] === "stop") {
    const id = positionals[1];
    if (!id && !values.all) throw new Error("Name the session of the agent to stop, or use --all.");
    const chosen = id ? holders.filter((holder) => holder.sessionId.startsWith(id)) : holders;
    if (id && chosen.length > 1)
      throw new Error(`More than one agent's session starts with ${id}. Give more of its ID.`);
    await Promise.all(chosen.map((holder) => stopHolder(holder)));
    console.log(
      chosen.length
        ? `Stopped ${chosen.length} ${chosen.length === 1 ? "agent" : "agents"}.`
        : "No agent runs for that session.",
    );
    return;
  }
  if (positionals.length) throw new Error(agentsHelp);
  if (values.json) {
    console.log(JSON.stringify(holders, null, 2));
    return;
  }
  if (!holders.length) {
    console.log("No agents run.");
    return;
  }
  for (const holder of holders.sort((a, b) => a.startedAt - b.startedAt))
    console.log(
      `${holder.sessionId.slice(0, 8)}  ${holder.name}  ${age(holder.startedAt)}  ${holder.cwd}`,
    );
}
