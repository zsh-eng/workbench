// A gh stand-in for tests. `pr view` prints FAKE_GH_PULL; `pr checkout`
// fetches refs/pull/<number>/head from FAKE_GH_REMOTE, as gh fetches from
// GitHub, then checks it out as the head branch, or detached with --detach.
// FAKE_GH_DELAY_MS slows each command, to watch progress by hand.
import { execFileSync } from "node:child_process";

await new Promise((done) => setTimeout(done, Number(process.env.FAKE_GH_DELAY_MS ?? 0)));

const [command, action, selector, ...rest] = process.argv.slice(2);
const pull = JSON.parse(process.env.FAKE_GH_PULL ?? "{}");
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] });

if (command === "pr" && action === "view") {
  process.stdout.write(JSON.stringify(pull));
} else if (command === "pr" && action === "checkout") {
  git("fetch", "-q", process.env.FAKE_GH_REMOTE, `refs/pull/${selector}/head`);
  if (rest.includes("--detach")) git("checkout", "-q", "--detach", "FETCH_HEAD");
  else git("checkout", "-q", "-b", pull.headRefName, "FETCH_HEAD");
} else {
  process.stderr.write(`fake gh: unknown command ${command} ${action}\n`);
  process.exit(1);
}
