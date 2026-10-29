// A gh stand-in for tests. `pr view` prints FAKE_GH_PULL; `pr checkout`
// fetches refs/pull/<number>/head from FAKE_GH_REMOTE, as gh fetches from
// GitHub, then checks it out as the head branch, or detached with --detach.
// `pr list --head <branch>` prints that branch's entry of FAKE_GH_PULLS, a
// JSON object of branch names and pull request lists. FAKE_GH_LOG names a
// file that gets each command's arguments as a line of JSON.
// FAKE_GH_DELAY_MS slows each command, to watch progress by hand. `pr create`
// copies its --body-file to FAKE_GH_BODY_OUT and prints FAKE_GH_CREATED, or
// with FAKE_GH_EXISTS fails as gh does for a branch whose pull request is open.
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync } from "node:fs";

await new Promise((done) => setTimeout(done, Number(process.env.FAKE_GH_DELAY_MS ?? 0)));

const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);
const [command, action, selector, ...rest] = argv;
const pull = JSON.parse(process.env.FAKE_GH_PULL ?? "{}");
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] });

if (command === "pr" && action === "view") {
  process.stdout.write(JSON.stringify(pull));
} else if (command === "pr" && action === "checkout") {
  git("fetch", "-q", process.env.FAKE_GH_REMOTE, `refs/pull/${selector}/head`);
  if (rest.includes("--detach")) git("checkout", "-q", "--detach", "FETCH_HEAD");
  else git("checkout", "-q", "-b", pull.headRefName, "FETCH_HEAD");
} else if (command === "pr" && action === "list") {
  const head = argv[argv.indexOf("--head") + 1];
  process.stdout.write(JSON.stringify(JSON.parse(process.env.FAKE_GH_PULLS ?? "{}")[head] ?? []));
} else if (command === "pr" && action === "create" && process.env.FAKE_GH_EXISTS) {
  const head = argv[argv.indexOf("--head") + 1];
  process.stderr.write(
    `a pull request for branch "${head}" into branch "main" already exists:\n${process.env.FAKE_GH_EXISTS}\n`,
  );
  process.exit(1);
} else if (command === "pr" && action === "create" && process.env.FAKE_GH_CREATED) {
  if (process.env.FAKE_GH_BODY_OUT)
    copyFileSync(argv[argv.indexOf("--body-file") + 1], process.env.FAKE_GH_BODY_OUT);
  process.stdout.write(`${process.env.FAKE_GH_CREATED}\n`);
} else {
  process.stderr.write(`fake gh: unknown command ${command} ${action}\n`);
  process.exit(1);
}
