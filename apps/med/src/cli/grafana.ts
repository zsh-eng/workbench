import { parseArgs } from "node:util";
import { clientPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import { chartRoutes, keychainCommand, type GrafanaSite } from "../shared/charts";
import { UsageError } from "./exit-status";
import { request } from "./review";

export const grafanaHelp = `Usage: med grafana                        List the Grafanas
       med grafana connect <address> --keychain <item>
                                          Use the token in a Keychain item
       med grafana connect <address> --token-stdin
                                          Use the token on standard input
       med grafana connect <address>      Check the token Med has
       med grafana remove <address>       Forget a Grafana
Options: --json, --port <port> (or MED_PORT),
         --state-dir <path> (or MED_STATE_DIR)

Charts in replies draw Grafana panels with a token that a Grafana service
account with the Viewer role gives. Keep the token in your Keychain, and Med
reads it there when a chart needs it:

  ${keychainCommand("grafana-acme")}
  med grafana connect https://grafana.acme.com --keychain grafana-acme

The first command asks for the token, so it stays out of your shell's history.
Connect checks the token with Grafana, then keeps the address and the item's
name in Med's settings. Settings → Grafana does the same.

An agent connects a Grafana with --keychain once the user has added the item.
It never asks for the token itself.`;

/** A Grafana's row: its address, then where its token is. */
function row(site: GrafanaSite) {
  const where = site.keychain
    ? `token in Keychain item ${site.keychain}`
    : site.token
      ? `token in Med, ending ${site.hint}`
      : "no token";
  return `${site.address}  ${where}`;
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** `med grafana`: Settings → Grafana from the command line, through the
 * running server, so its checks and files are the same. */
export async function runGrafanaCommand(args: string[], print = console.log) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      keychain: { type: "string" },
      "token-stdin": { type: "boolean" },
      json: { type: "boolean" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    print(grafanaHelp);
    return;
  }
  const [action = "list", address] = positionals;
  const valid =
    (action === "list" && positionals.length <= 1) ||
    ((action === "connect" || action === "remove") && positionals.length === 2);
  const connecting = action === "connect";
  if (
    !valid ||
    (!connecting && (values.keychain !== undefined || values["token-stdin"])) ||
    (values.keychain !== undefined && values["token-stdin"])
  )
    throw new UsageError(grafanaHelp);
  if (values["token-stdin"] && process.stdin.isTTY)
    throw new UsageError(
      "Pipe the token in, as: pbpaste | med grafana connect <address> --token-stdin. " +
        "Or keep it in your Keychain: med grafana --help shows how.",
    );
  const stateDir = getStateDirectory(values["state-dir"]);
  const connection = await readConnection(stateDir, await clientPort(stateDir, values.port));
  const call = (route: { path: string }, body?: unknown) =>
    request(connection, route.path, fetch, body);

  if (action === "list") {
    const { sites } = chartRoutes.sites.output.parse(await call(chartRoutes.sites));
    if (values.json) print(JSON.stringify({ sites }, null, 2));
    else if (!sites.length) print("No Grafana yet. med grafana --help shows how to connect one.");
    else for (const site of sites) print(row(site));
    return;
  }
  if (action === "remove") {
    const { sites } = chartRoutes.remove.output.parse(await call(chartRoutes.remove, { address }));
    if (values.json) print(JSON.stringify({ sites }, null, 2));
    else print(`Removed ${address}. Its Keychain item, if any, stays in the Keychain.`);
    return;
  }
  const token = values["token-stdin"] ? await readStdin() : undefined;
  if (values["token-stdin"] && !token) throw new UsageError("Standard input held no token.");
  const answer = chartRoutes.connect.output.parse(
    await call(chartRoutes.connect, {
      address,
      ...(token ? { token } : {}),
      ...(values.keychain !== undefined ? { keychain: values.keychain } : {}),
    }),
  );
  if (values.json) {
    print(JSON.stringify(answer, null, 2));
    return;
  }
  const about = [
    answer.organization && `Connected to ${answer.organization}`,
    answer.version && `Grafana ${answer.version}`,
  ].filter(Boolean);
  print(`${about.join(" · ") || "Connected"}.`);
  print(row(answer.site));
}
