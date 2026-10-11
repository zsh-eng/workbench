// The agent's side of the Trailhead demo: a Claude Code transcript for the
// "Search filters" task. Med reads it from
// ~/.claude/projects/<project>/<session>.jsonl and shows it in the Session
// pane. The lines follow the format that apps/med/src/shared/agent-session-claude.ts
// reads. Only the repository path is real, and Med shows it relative.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  cssV1,
  cssV2,
  filtersV1,
  filtersV2,
  rounds,
  searchBarV1,
  searchBarV2,
} from "./fixture.ts";

export const sessionId = "6f1d2c84-3b9a-4e57-a0c2-9d8e71b54f30";

/** What a round that Med records live needs: time to pass, files to change,
 * and the next review to hand over, which returns its link. */
export interface Live {
  pause(ms: number): Promise<void>;
  write(files: Record<string, string>): void;
  handoff(): string;
}

/** The lines of `after` that differ from `before`, with the same lines around them removed. */
function edit(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  return {
    old_string: a.slice(start, a.length - end).join("\n"),
    new_string: b.slice(start, b.length - end).join("\n"),
  };
}

export class Transcript {
  // The session started a while ago; Med orders its own sent messages
  // among the lines by time.
  private time = Date.now() - 4 * 60_000;
  private count = 0;
  /** A live round writes each line at the time it happens. */
  private live = false;
  readonly path: string;

  constructor(
    home: string,
    private readonly repo: string,
  ) {
    const project = join(home, ".claude", "projects", "-trailhead");
    mkdirSync(project, { recursive: true });
    this.path = join(project, `${sessionId}.jsonl`);
  }

  private write(entry: Record<string, unknown>, seconds = 2) {
    this.time = this.live ? Date.now() : this.time + seconds * 1000;
    this.count += 1;
    const line = {
      uuid: `00000000-0000-4000-8000-${String(this.count).padStart(12, "0")}`,
      timestamp: new Date(this.time).toISOString(),
      cwd: this.repo,
      sessionId,
      ...entry,
    };
    appendFileSync(this.path, `${JSON.stringify(line)}\n`);
  }

  private assistant(block: Record<string, unknown>, extra = {}, end = false) {
    this.write({
      type: "assistant",
      message: {
        id: `msg_demo${this.count}`,
        role: "assistant",
        model: "claude-sonnet-5-5",
        stop_reason: end ? "end_turn" : null,
        content: [block],
      },
      ...extra,
    });
  }

  user(text: string) {
    this.write({ type: "user", message: { role: "user", content: text } }, 20);
  }

  thought(ms: number) {
    this.assistant(
      { type: "thinking", thinking: "" },
      { thinkingDurationMs: ms },
    );
  }

  say(text: string, end = false) {
    this.assistant({ type: "text", text }, {}, end);
  }

  tool(
    name: string,
    input: Record<string, unknown>,
    output: string,
    result: Record<string, unknown> = {},
    seconds = 3,
  ) {
    const id = `toolu_demo${this.count}`;
    this.assistant({ type: "tool_use", id, name, input });
    this.write(
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: id, content: output }],
        },
        toolUseResult: result,
      },
      seconds,
    );
  }

  file(name: string) {
    return join(this.repo, name);
  }

  /** Claude Code's report that a background command ended. */
  finished(task: string, summary: string) {
    this.write({
      type: "user",
      message: {
        role: "user",
        content: `<task-notification>\n<task-id>${task}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`,
      },
    });
  }

  /** The first prompt, before the first review: Med reads the directory from it. */
  start() {
    this.user(
      "Let people filter trails from the search box with `difficulty:moderate`, `under:12km`, and `is:loop`. Other words stay free text. Add tests, then hand the change to me in Med.",
    );
  }

  /** Round one: the filters, the tests, and the handoff. */
  first(link: string) {
    this.thought(2100);
    this.say(
      "I'll read the search module first, then parse the filters before ranking.",
    );
    this.tool(
      "Bash",
      {
        command: "grep -n export src/search/*.ts",
        description: "List the search module's exports",
      },
      "src/search/index.ts:4:export function searchTrails(text: string): Trail[] {\nsrc/search/query.ts:7:export function parseQuery(input: string): Query {",
    );
    this.tool(
      "Write",
      { file_path: this.file("src/search/filters.ts"), content: filtersV1 },
      "File created successfully.",
    );
    this.tool(
      "Bash",
      { command: "bun test", description: "Run the tests" },
      "bun test v1.3.5\n\n 9 pass\n 0 fail\n 21 expect() calls\nRan 9 tests across 1 file. [48.00ms]",
    );
    this.handoff(link, rounds[0]!.brief, "bq4w8n2");
  }

  /** Round two, live while Med records it: the agent takes the reviewer's
   * comment, edits the files one at a time, and hands over the next review. */
  async second(live: Live) {
    this.live = true;
    this.finished(
      "bq4w8n2",
      'Background command "Wait for the review" completed (exit code 0)',
    );
    // Med shows the agent idle until it thinks, so it thinks at once.
    await live.pause(200);
    this.thought(1600);
    await live.pause(300);
    this.say(
      "You want the active filters in the search bar, so people can see why trails are hidden. I'll list them under the input.",
    );
    await live.pause(900);
    for (const [name, before, after] of [
      ["src/search/filters.ts", filtersV1, filtersV2],
      ["src/ui/SearchBar.tsx", searchBarV1, searchBarV2],
      ["src/ui/search.css", cssV1, cssV2],
    ] as const)
      await this.change(live, name, before, after);
    await this.run(
      live,
      { command: "bun test", description: "Run the tests" },
      "bun test v1.3.5\n\n 11 pass\n 0 fail\n 25 expect() calls\nRan 11 tests across 1 file. [51.00ms]",
    );
    this.handoff(live.handoff(), rounds[1]!.brief, "b5t1x7k");
  }

  /** A live edit: the call, the file changing, then the result. */
  private async change(live: Live, name: string, before: string, after: string) {
    const id = `toolu_demo${this.count}`;
    this.assistant({
      type: "tool_use",
      id,
      name: "Edit",
      input: { file_path: this.file(name), ...edit(before, after) },
    });
    await live.pause(500);
    live.write({ [name]: after });
    await live.pause(300);
    this.result(id, "The file has been updated successfully.", {
      originalFile: before,
    });
    await live.pause(700);
  }

  /** A live command: the call, a moment, then its output. */
  private async run(
    live: Live,
    input: Record<string, unknown>,
    output: string,
  ) {
    const id = `toolu_demo${this.count}`;
    this.assistant({ type: "tool_use", id, name: "Bash", input });
    await live.pause(1300);
    this.result(id, output, {});
    await live.pause(500);
  }

  private result(id: string, output: string, result: Record<string, unknown>) {
    this.write({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: output }],
      },
      toolUseResult: result,
    });
  }

  private handoff(link: string, brief: string, task: string) {
    this.tool(
      "Bash",
      {
        command: `med review create --key demo --title "Search filters" --repo . --working --brief - <<'BRIEF'\n${brief.trim()}\nBRIEF`,
        description: "Hand the change to Med",
      },
      link,
    );
    this.tool(
      "Bash",
      {
        command: "med review wait --key demo",
        description: "Wait for the review",
        run_in_background: true,
      },
      `Command running in background with ID: ${task}.`,
      { backgroundTaskId: task },
      1,
    );
    this.say(`${brief.trim()}\n\n${link}`, true);
  }
}
