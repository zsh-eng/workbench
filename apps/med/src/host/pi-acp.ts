// `med __pi <pi> [args…]`, or `node pi-acp.js <pi> [args…]`: runs Pi as an
// Agent Client Protocol agent on stdin and stdout, through Med's bridge
// (pi-bridge.ts). Med starts it in a holder, as it starts its other agents.
import { piBridge } from "./pi-bridge.ts";

const argv = process.argv.slice(2);
const pi = argv.slice(argv[0] === "__pi" ? 1 : 0);
if (!pi.length) {
  process.stderr.write("Usage: med __pi <pi> [args…]\n");
  process.exit(2);
}
const bridge = piBridge({ pi, write: (line) => process.stdout.write(`${line}\n`) });
// Lines split on \n alone, as Med writes them.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).replace(/\r$/, "");
    buffer = buffer.slice(end + 1);
    if (line.trim()) bridge.receive(line);
  }
});
const close = () => {
  bridge.close();
  process.exit(0);
};
process.stdin.on("end", close);
process.on("SIGTERM", close);
