import {
  PaginationEngine,
  type EnginePaginationEvent,
  type PaginationEngineWork,
} from "@/lib/pagination-v2/engine";
import { parseChapterHtml } from "@/lib/pagination-v2";
import type { PaginationCommand } from "@/lib/pagination-v2/protocol";
import { PaginationJobScheduler } from "@/lib/pagination-v2/worker/scheduler";
import {
  coalesceQueuedCommands,
  getCommandPriority,
  startsLayoutEpoch,
  type QueuedPaginationCommand,
} from "@/lib/pagination-v2/worker/scheduler-policy";
import type {
  Block,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
  SpreadIntent,
} from "@/lib/pagination-v2/types";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const BASE_LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left",
};

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };
const FORWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "forward",
};
const CHAPTER_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "chapter",
};
const SCRUBBER_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "scrubber",
};

function buildConfig(baseSizePx: number): PaginationConfig {
  return {
    fontConfig: {
      ...BASE_FONT_CONFIG,
      baseSizePx,
    },
    layoutTheme: {
      ...BASE_LAYOUT_THEME,
      baseFontSizePx: baseSizePx,
    },
    viewport: { width: 620, height: 860 },
  };
}

function buildBlocks(id: string): Block[] {
  return [{ type: "spacer", id }];
}

function addChapter(chapterIndex: number): PaginationCommand {
  return {
    type: "addChapter",
    chapterIndex,
    blocks: buildBlocks(`add-${chapterIndex}`),
  };
}

function updateChapter(chapterIndex: number, id: string): PaginationCommand {
  return {
    type: "updateChapter",
    chapterIndex,
    blocks: buildBlocks(id),
  };
}

function updatePaginationConfig(baseSizePx: number): PaginationCommand {
  return {
    type: "updatePaginationConfig",
    paginationConfig: buildConfig(baseSizePx),
  };
}

function updateSpreadConfig(columns: 1 | 2 | 3): PaginationCommand {
  return {
    type: "updateSpreadConfig",
    spreadConfig: { columns, chapterFlow: "continuous" },
  };
}

function goToPage(page: number): PaginationCommand {
  return { type: "goToPage", page, intent: SCRUBBER_JUMP_INTENT };
}

function goToChapter(chapterIndex: number): PaginationCommand {
  return { type: "goToChapter", chapterIndex, intent: CHAPTER_JUMP_INTENT };
}

function nextSpread(): PaginationCommand {
  return { type: "nextSpread", intent: FORWARD_LINEAR_INTENT };
}

function initCommand(): PaginationCommand {
  return {
    type: "init",
    totalChapters: 2,
    paginationConfig: buildConfig(16),
    spreadConfig: { columns: 1, chapterFlow: "continuous" },
    intent: REPLACE_INTENT,
    initialChapterIndex: 0,
    firstChapterBlocks: buildBlocks("first"),
  };
}

function commandLabel(command: PaginationCommand): string {
  switch (command.type) {
    case "init":
      return "init";
    case "addChapter":
      return `add:${command.chapterIndex}`;
    case "updateChapter":
      return `update:${command.chapterIndex}:${command.blocks[0]?.id}`;
    case "updatePaginationConfig":
      return `config:${command.paginationConfig.fontConfig.baseSizePx}`;
    case "updateSpreadConfig":
      return `spread:${command.spreadConfig.columns}`;
    case "goToPage":
      return `page:${command.page}`;
    case "goToChapter":
      return `chapter:${command.chapterIndex}`;
    case "nextSpread":
      return "next";
    case "prevSpread":
      return "prev";
    case "goToTarget":
      return `target:${command.chapterIndex}:${command.targetId}`;
  }
}

interface SchedulerHarness {
  scheduler: PaginationJobScheduler;
  steps: string[];
}

function createHarness(
  stepCounts: Record<string, number> = {},
): SchedulerHarness {
  const steps: string[] = [];
  const scheduler = new PaginationJobScheduler((command) => {
    const label = commandLabel(command);
    let remainingSteps = stepCounts[label] ?? 1;

    return (function* (): PaginationEngineWork {
      while (remainingSteps > 0) {
        if (remainingSteps <= 0) return;
        steps.push(label);
        remainingSteps--;
        if (remainingSteps > 0) yield;
      }
    })();
  });

  return { scheduler, steps };
}

function stepScheduler(harness: SchedulerHarness): string | null {
  harness.scheduler.expandIncomingCommands();

  const job = harness.scheduler.peek();
  if (!job) return null;

  const stepIndex = harness.steps.length;
  const result = job.work.next();
  if (result.done) harness.scheduler.remove(job);

  return harness.steps[stepIndex] ?? null;
}

function runAll(harness: SchedulerHarness): string[] {
  const labels: string[] = [];
  while (harness.scheduler.hasWork()) {
    const label = stepScheduler(harness);
    if (label) labels.push(label);
  }
  return labels;
}

describe("pagination scheduler policy", () => {
  it("coalesces supersedable commands while preserving non-supersedable order", () => {
    const commands: QueuedPaginationCommand[] = [
      { command: addChapter(0) },
      { command: updateChapter(2, "old-chapter-2") },
      { command: goToPage(2) },
      { command: updatePaginationConfig(17) },
      { command: goToPage(7) },
      { command: goToChapter(5) },
      { command: goToChapter(2) },
      { command: updateChapter(2, "new-chapter-2") },
      { command: updateChapter(1, "chapter-1") },
      { command: updatePaginationConfig(18) },
      { command: addChapter(1) },
      { command: updateSpreadConfig(2) },
    ];

    const coalesced = coalesceQueuedCommands(commands);
    expect(coalesced.map((entry) => entry.command.type)).toEqual([
      "addChapter",
      "goToPage",
      "goToChapter",
      "updateChapter",
      "updateChapter",
      "updatePaginationConfig",
      "addChapter",
      "updateSpreadConfig",
    ]);

    expect(coalesced.map((entry) => commandLabel(entry.command))).toEqual([
      "add:0",
      "page:7",
      "chapter:2",
      "update:2:new-chapter-2",
      "update:1:chapter-1",
      "config:18",
      "add:1",
      "spread:2",
    ]);
  });

  it("assigns command priorities and layout epoch boundaries", () => {
    expect(getCommandPriority(nextSpread())).toBe("user");
    expect(getCommandPriority(goToPage(4))).toBe("user");
    expect(getCommandPriority(updateSpreadConfig(2))).toBe("user");
    expect(getCommandPriority(addChapter(1))).toBe("background");
    expect(getCommandPriority(updatePaginationConfig(18))).toBe("layout");

    expect(startsLayoutEpoch(initCommand())).toBe(true);
    expect(startsLayoutEpoch(updatePaginationConfig(18))).toBe(true);
    expect(startsLayoutEpoch(updateChapter(1, "chapter-1"))).toBe(true);
    expect(startsLayoutEpoch(addChapter(1))).toBe(false);
    expect(startsLayoutEpoch(nextSpread())).toBe(false);
  });
});

describe("PaginationJobScheduler", () => {
  it("lets user commands preempt unfinished background jobs", () => {
    const harness = createHarness({ "add:1": 3 });

    harness.scheduler.pushCommand(addChapter(1));
    expect(stepScheduler(harness)).toBe("add:1");

    harness.scheduler.pushCommand(nextSpread());
    expect(stepScheduler(harness)).toBe("next");
    expect(stepScheduler(harness)).toBe("add:1");
    expect(stepScheduler(harness)).toBe("add:1");
    expect(harness.scheduler.hasWork()).toBe(false);
  });

  it("keeps an unfinished job at the head of its queue until done", () => {
    const harness = createHarness({ "add:1": 2 });

    harness.scheduler.pushCommand(addChapter(1));
    harness.scheduler.pushCommand(addChapter(2));

    expect(runAll(harness)).toEqual(["add:1", "add:1", "add:2"]);
  });

  it("runs user jobs before layout jobs and layout jobs before background jobs", () => {
    const harness = createHarness();

    harness.scheduler.pushCommand(addChapter(1));
    harness.scheduler.pushCommand(updatePaginationConfig(18));
    harness.scheduler.pushCommand(goToPage(7));

    expect(runAll(harness)).toEqual(["page:7", "config:18", "add:1"]);
  });

  it("removes a superseded unfinished job from the queue", () => {
    const harness = createHarness({
      "config:18": 3,
      "config:20": 2,
    });

    harness.scheduler.pushCommand(updatePaginationConfig(18));
    expect(stepScheduler(harness)).toBe("config:18");

    harness.scheduler.pushCommand(updatePaginationConfig(20));
    expect(stepScheduler(harness)).toBe("config:20");
    expect(stepScheduler(harness)).toBe("config:20");
    expect(harness.steps).toEqual(["config:18", "config:20", "config:20"]);
    expect(harness.scheduler.hasWork()).toBe(false);
  });

  it("clears queued jobs when init arrives", () => {
    const harness = createHarness();

    harness.scheduler.pushCommand(addChapter(1));
    harness.scheduler.expandIncomingCommands();

    harness.scheduler.pushCommand(initCommand());

    expect(runAll(harness)).toEqual(["init"]);
  });

  it("cancels incoming and active work when a Reader session ends", () => {
    const harness = createHarness({ "add:1": 3 });

    harness.scheduler.pushCommand(addChapter(1));
    expect(stepScheduler(harness)).toBe("add:1");
    harness.scheduler.pushCommand(addChapter(2));

    harness.scheduler.cancelAll();

    expect(harness.scheduler.hasWork()).toBe(false);
    expect(runAll(harness)).toEqual([]);
  });
});

it("lays out the chapter a waiting jump needs before other chapters", () => {
  const events: EnginePaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));
  const scheduler = new PaginationJobScheduler(
    (command) => engine.createWork(command),
    () => engine.pendingJumpChapter,
  );
  /** The chapters whose `addChapter` work ran, in order. */
  const added: number[] = [];
  const run = () => {
    for (;;) {
      scheduler.expandIncomingCommands();
      const job = scheduler.peek();
      if (!job) return;
      if (job.chapterIndex !== null && !added.includes(job.chapterIndex))
        added.push(job.chapterIndex);
      if (job.work.next().done) scheduler.remove(job);
    }
  };
  const blocks = (chapter: number) =>
    parseChapterHtml(`<body><p>Chapter ${chapter} text.</p></body>`);

  scheduler.pushCommand({ ...initCommand(), totalChapters: 4 });
  run();
  events.length = 0;
  for (const chapter of [1, 2, 3])
    scheduler.pushCommand({
      type: "addChapter",
      chapterIndex: chapter,
      blocks: blocks(chapter),
    });
  scheduler.pushCommand(goToChapter(3));
  run();

  expect(added).toEqual([3, 1, 2]);
  const jump = events.find(
    (event) => event.type === "pageContent" && event.intent.kind === "jump",
  );
  const page =
    jump && "spread" in jump
      ? jump.spread.slots.find((slot) => slot.kind === "page")
      : undefined;
  expect(page?.kind === "page" && page.page.chapterIndex).toBe(3);
});

it("coalesces page lookups within each consumer without dropping another consumer", () => {
  const lookup = (
    scope: string,
    requestId: number,
  ): QueuedPaginationCommand => ({
    command: { type: "locateAnchors", scope, requestId, anchors: [] },
  });
  const note = lookup("default", 1);
  const oldHistory = lookup("history", 2);
  const newHistory = lookup("history", 3);
  expect(coalesceQueuedCommands([note, oldHistory, newHistory])).toEqual([
    note,
    newHistory,
  ]);
});
