import { describe, expect, it } from "vitest";
import { readReviewOutput } from "../../src/shared/review-output";

// The reader takes review output in the shapes that real tools write. These
// are parser edge cases, kept as a focused test (docs/TESTING.md): the browser
// test shows the result on the Overview.

const codeReview = `## Code review

2 Important, 1 Nit, 0 Pre-existing

### Important
1. **src/http.ts:42** — Retry ignores the abort signal, so a closed tab keeps retrying.
   - Fixed: the signal now goes to each attempt.
2. \`src/cache.ts:10-14\` The cache key leaves out the method.

### Nit
- src/util.ts:3 — \`sleep\` could use node:timers. Won't fix: Bun lacks it.
`;

const handoff = `Retries now back off, so a flaky network no longer fails the sync.

## Proof
- \`bun run test\` — 42 passed
- \`bun run lint\`: ✓
- \`bun run build\` failed: 1 type error in src/http.ts
- Screenshot: /tmp/shots/retry.png
- Clip: \`out/retry.mp4\`

### Not covered
- Safari
- Offline for more than 5 minutes

## Generated
- \`src/api/client/**\`
- \`*.pb.ts\`
`;

const codex = `Review: the patch has issues.
- [P1] Handle the empty list — src/list.ts:20-24
- [P3] Typo in a comment — src/list.ts:3
`;

const fenced = `**Checks**

\`\`\`sh
$ bun test
 12 pass
 0 fail
$ bunx tsc --noEmit
error TS2322: Type 'string' is not assignable
\`\`\`

Nothing to fix.
`;

describe("review output", () => {
  it("reads /code-review findings with their counts, places, and resolutions", () => {
    const output = readReviewOutput([codeReview]);
    expect(output.counts).toEqual({ important: 2, nit: 1, preExisting: 0 });
    expect(output.findings).toEqual([
      {
        severity: "important",
        title: "Retry ignores the abort signal, so a closed tab keeps retrying.",
        file: "src/http.ts",
        line: 42,
        state: "fixed",
        reason: "the signal now goes to each attempt.",
      },
      {
        severity: "important",
        title: "The cache key leaves out the method.",
        file: "src/cache.ts",
        line: 10,
        endLine: 14,
        state: "open",
      },
      {
        severity: "nit",
        title: "`sleep` could use node:timers.",
        file: "src/util.ts",
        line: 3,
        state: "wont-fix",
        reason: "Bun lacks it.",
      },
    ]);
    expect(output.proof).toBeUndefined();
  });

  it("reads a hand-off's proof, what it misses, its explainer, and generated globs", () => {
    const output = readReviewOutput([handoff]);
    expect(output.explainer).toBe(
      "Retries now back off, so a flaky network no longer fails the sync.",
    );
    // A screenshot outside the Proof section is proof when a line names it so.
    expect(readReviewOutput(["Done.\n\nScreenshot: /tmp/a.png"]).proof?.media).toEqual([
      "/tmp/a.png",
    ]);
    expect(output.proof).toEqual({
      checks: [
        { command: "bun run test", result: "42 passed", status: "passed" },
        { command: "bun run lint", result: "✓", status: "passed" },
        {
          command: "bun run build",
          result: "failed: 1 type error in src/http.ts",
          status: "failed",
        },
      ],
      media: ["/tmp/shots/retry.png", "out/retry.mp4"],
      misses: ["Safari", "Offline for more than 5 minutes"],
      notes: [],
    });
    expect(output.generated).toEqual(["src/api/client/**", "*.pb.ts"]);
    expect(output.findings).toEqual([]);
  });

  it("reads Codex priorities as Important and Nit, and commands in a fence", () => {
    expect(readReviewOutput([codex]).findings).toEqual([
      {
        severity: "important",
        title: "Handle the empty list",
        file: "src/list.ts",
        line: 20,
        endLine: 24,
        state: "open",
      },
      { severity: "nit", title: "Typo in a comment", file: "src/list.ts", line: 3, state: "open" },
    ]);
    const output = readReviewOutput([fenced]);
    expect(output.proof?.checks).toEqual([
      { command: "bun test", result: "12 pass", status: "passed" },
      { command: "bunx tsc --noEmit", status: "failed" },
    ]);
    expect(output.nothingToFix).toBe(true);
  });

  it("finds nothing in prose without its parts", () => {
    const output = readReviewOutput([
      "I changed the parser so that errors no longer stop it. The tests pass.",
      "- a plain list item\n- [ ] a task",
      // An image in an explanation is not proof.
      "![The new header](docs/header.png)",
    ]);
    expect(output).toEqual({
      findings: [],
      generated: [],
      explainer: "I changed the parser so that errors no longer stop it. The tests pass.",
    });
  });
});
