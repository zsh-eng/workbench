import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { viewSettings } from "../../src/web/data/view-settings";
import type { ReviewGuide } from "../../src/shared/review-guide";
import {
  firstCommit,
  mount,
  mountApp,
  prepareWindow,
  root,
  secondCommit,
  unmountApp,
} from "./app-fixture";

beforeEach(prepareWindow);
afterEach(unmountApp);

describe("review guide", () => {
  // The file headers in the diff stream, by their text.
  const streamFiles = () =>
    [...document.querySelectorAll("[data-stream-file]")].map((node) => node.textContent);

  test("shows a version's proof first, what changed since the last review, and its findings", async () => {
    await mountApp({
      savedReview: true,
      versions: 2,
      // The second version's guide: its summary has the proof and findings.
      guide: {
        summary: [
          "## Proof",
          "- `bun run test`: 42 passed",
          "- `bun run build` failed: 1 type error",
          "- Screenshot: /tmp/shots/rename.png",
          "",
          "### Not covered",
          "- Safari",
          "",
          "## Findings",
          "- Important `src/alpha.ts:1` Callers still import the old name.",
          "- Nit `src/beta.ts:2` Rename `shared`. Won't fix: it matches upstream.",
        ].join("\n"),
        segments: [{ title: "Rename", files: ["src/**"] }],
      },
      since: {
        from: 1,
        to: 2,
        basis: "previous",
        files: [
          { path: "src/alpha.ts", change: "changed", target: "saved-target" },
          { path: "src/old.ts", change: "gone", target: "saved-target" },
        ],
      },
    });
    // A second version opens on the Overview.
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof).toMatchTextContent(/^Proof1 of 2 failed/);
    await expect.element(proof.getByText("bun run test")).toBeVisible();
    await expect.element(proof.getByText("42 passed")).toBeVisible();
    await expect.element(proof.getByLabelText("failed")).toBeVisible();
    await expect.element(proof.getByText("/tmp/shots/rename.png")).toBeVisible();
    await expect
      .element(proof.getByRole("list", { name: "Not covered" }))
      .toMatchTextContent("Safari");
    const since = overview.getByRole("region", { name: "Since your last review" });
    await expect
      .element(since)
      .toMatchTextContent(/^New since you looked2 filesWhat changed since the hand-off before\./);
    await expect.element(since.getByRole("button", { name: /Gone src\/old\.ts/ })).toBeDisabled();
    const findings = overview.getByRole("region", { name: "Findings" });
    await expect.element(findings).toMatchTextContent(/^Findings1 open/);
    await expect
      .element(
        findings.getByRole("button", {
          name: /^Nit\s*Rename shared\.\s*src\/beta\.ts:2\s*Won't fix: it matches upstream\.$/,
        }),
      )
      .toBeVisible();
    await expect.element(overview.getByText(/1 open finding/)).toBeVisible();
    // The proof is first, under the title; no offer shows beside it.
    const order = [proof, since, findings].map((part) => part.element());
    expect(
      order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);

    // A finding opens its line in the Review's diff.
    await findings.getByRole("button", { name: /Callers still import the old name/ }).click();
    await expect.element(overview).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() =>
        [...document.querySelectorAll("diffs-container")].some(
          (node) => !!node.shadowRoot?.querySelector("[data-selected-line]"),
        ),
      )
      .toBe(true);
  });

  test("shows a proof table whose columns share the width, breaking long commands at their separators, and counts its checks", async () => {
    // As an agent wrote it: one row's command and result are long, and one
    // row's only code is in its result, so it is a note, not a check.
    const command =
      "./gradlew :telemetry:histogram-core-internal:test --tests 'ClassicBucketsTest'";
    await mountApp({
      savedReview: true,
      versions: 2,
      guide: {
        summary: [
          "## Proof",
          "",
          "| Check | Scope | Result |",
          "| --- | --- | --- |",
          `| \`${command}\` | for \`ClassicBuckets*\` and \`BucketBoundaryTest\` | 18 tests pass (2+9+7). CI on the branch is green across the three JVM targets after the rerun. |`,
          "| `bun run lint` | all of `src/` | 1 error in src/beta.ts |",
          "| Fixture | Generated | `histogram()` is `registry.timer(bucketName())`; the name has `platformVersion` and the bucket set |",
        ].join("\n"),
        segments: [{ title: "Rename", files: ["src/**"] }],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof).toMatchTextContent(/^Proof1 of 2 failed/);
    const table = proof.getByRole("table");
    await expect.element(table.getByRole("cell", { name: command })).toBeVisible();
    // The rows show once, in the table, not again as check rows.
    expect(proof.getByText(command).elements()).toHaveLength(1);
    const box = table.element() as HTMLElement;
    const code = table.getByRole("cell", { name: command }).element().querySelector("code")!;
    // The command can break at its separators, and nowhere in a word; its
    // text stays as written, for a copy.
    await expect
      .poll(() => code.innerHTML)
      .toBe(
        "./gradlew :telemetry<wbr>:histogram-<wbr>core-<wbr>internal<wbr>:test --tests 'ClassicBucketsTest'",
      );
    expect(code.textContent).toBe(command);
    // In the narrow column beside the Guide's rail, every column shows: the
    // table fits without scrolling, the command takes a few lines, none of
    // them a letter or two, and the result's prose wraps.
    await page.viewport(1100, 800);
    await expect.element(page.getByRole("navigation", { name: "Guide" })).toBeVisible();
    await expect.poll(() => box.scrollWidth - box.clientWidth).toBeLessThanOrEqual(0);
    const lines = [...code.getClientRects()];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const line of lines) expect(line.width).toBeGreaterThan(48);
    // At phone width a table that cannot fit with whole words scrolls in its
    // own box, and the page does not.
    await page.viewport(390, 800);
    await expect.poll(() => box.scrollWidth > box.clientWidth).toBe(true);
    for (const part of [proof.element(), overview.element()])
      await expect.poll(() => part.scrollWidth - part.clientWidth).toBeLessThanOrEqual(0);
  });

  test("a guide summary's proof shows once, in the Proof part, and the rest of the summary stays", async () => {
    await mountApp({
      savedReview: true,
      guide: {
        summary: [
          "Renames the export, so the CSV keeps its old column names.",
          "",
          "## Proof",
          "",
          "| Check | Result |",
          "| --- | --- |",
          "| `bun run test` | 3 passed |",
          "",
          "### Not covered",
          "",
          "- The import.",
          "",
          "## Read first",
          "",
          "The rename in alpha.ts; beta.ts follows it.",
        ].join("\n"),
        segments: [{ title: "Rename alpha", files: ["src/alpha.ts"] }],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    const proof = overview.getByRole("region", { name: "Proof" });
    await expect.element(proof.getByRole("table")).toBeVisible();
    await expect.element(proof.getByText("The import.")).toBeVisible();
    await expect
      .element(overview.getByText("The rename in alpha.ts; beta.ts follows it."))
      .toBeVisible();
    await expect.element(overview.getByText(/^Renames the export/)).toBeVisible();
    // One table, one list of misses, and no Proof heading in the summary.
    expect(overview.getByRole("table").elements()).toHaveLength(1);
    expect(overview.getByText("The import.").elements()).toHaveLength(1);
    expect(overview.getByRole("heading", { name: "Proof", level: 2 }).elements()).toHaveLength(0);
  });

  test("offers a practice where it would help, and a dismissed one stays dismissed", async () => {
    const guide: ReviewGuide = { segments: [{ title: "Rename", files: ["src/**"] }] };
    const overview = page.getByRole("region", { name: "Guide overview" });
    const explainOffer = overview.getByRole("complementary", { name: "No explanation yet" });
    await mountApp({
      savedReview: true,
      guide,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], drafts: [] },
    });
    // Without an explanation, the agent can be asked for one. The request
    // waits in the message box; the reader sends it.
    await expect.element(explainOffer).toBeVisible();
    await explainOffer.getByRole("button", { name: "Ask the agent to explain" }).click();
    const panel = page.getByRole("region", { name: "Agent session" });
    await expect
      .element(panel.getByRole("button", { name: "Remove Explain this change" }))
      .toBeVisible();
    await explainOffer.getByRole("button", { name: "Dismiss" }).click();
    // A review without proof has no card for it: nothing takes its place.
    await expect.element(explainOffer).not.toBeInTheDocument();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);

    // Dismissed offers stay dismissed in the next review.
    root?.unmount();
    mount?.remove();
    await mountApp({ savedReview: true, guide });
    await expect.element(overview).toBeVisible();
    expect(overview.getByRole("complementary").elements()).toHaveLength(0);
  });

  test("opens on the overview and reads one segment at a time with its comments", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the **export** in two files.",
        segments: [
          {
            title: "Rename alpha",
            area: "core",
            critical: true,
            summary: "The constant becomes `after`.",
            files: ["src/alpha.ts"],
            comments: [
              {
                file: "src/alpha.ts",
                line: 1,
                side: "new",
                kind: "risk",
                body: "Callers still import the `old` name.",
              },
              {
                file: "src/alpha.ts",
                side: "new",
                kind: "note",
                body: "The module keeps one export.",
              },
            ],
          },
          {
            title: "Rename beta",
            summary: "The same rename.",
            files: ["src/beta.ts"],
          },
        ],
      },
    });
    await expect
      .element(page.getByRole("radio", { name: "Review" }))
      .toHaveAttribute("aria-checked", "true");
    const overview = page.getByRole("region", { name: "Guide overview" });
    await expect.element(overview.getByText(/^Renames the/)).toBeVisible();
    // The Overview does not repeat the segments: the rail lists them.
    await expect.element(overview.getByText(/^2 segments · 2 comments/)).toBeVisible();
    expect(overview.getByRole("button", { name: /Rename alpha/ }).query()).toBeNull();
    const rail = page.getByRole("navigation", { name: "Guide" });
    await expect
      .element(rail.getByRole("button", { name: "1. Rename alpha, needs care" }))
      .toBeVisible();

    await userEvent.keyboard("j");
    await expect.element(page.getByRole("heading", { name: "Rename alpha" })).toBeVisible();
    // The agent's comment shows its Markdown.
    await expect.element(page.getByText("Callers still import the old name.")).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-guide-note] p code")?.textContent)
      .toBe("old");
    // A comment on the whole file follows the segment's summary.
    await expect.element(page.getByText("On whole files")).toBeVisible();
    await expect.element(page.getByText("The module keeps one export.")).toBeVisible();
    await expect.poll(streamFiles).toEqual([expect.stringContaining("alpha.ts")]);

    await userEvent.keyboard("j");
    await expect.element(page.getByRole("heading", { name: "Rename beta" })).toBeVisible();
    await expect.poll(streamFiles).toEqual([expect.stringContaining("beta.ts")]);
    await userEvent.keyboard("k");
    await expect.poll(streamFiles).toEqual([expect.stringContaining("alpha.ts")]);
  });
  test("where the Guide's rail hides, its parts step in the review's header", async () => {
    await page.viewport(1280, 800);
    localStorage.setItem("med:guide-rail", "closed");
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          { title: "Rename alpha", files: ["src/alpha.ts"] },
          { title: "Rename beta", files: ["src/beta.ts"] },
        ],
      },
    });
    await expect.element(page.getByRole("navigation", { name: "Guide" })).not.toBeInTheDocument();
    const stepper = page.getByRole("group", { name: "Guide parts" });
    await expect.element(stepper).toHaveTextContent("Overview");
    await expect.element(stepper.getByRole("button", { name: "Previous part" })).toBeDisabled();
    await stepper.getByRole("button", { name: "Next part" }).click();
    await expect.element(page.getByRole("heading", { name: "Rename alpha" })).toBeVisible();
    await expect.element(stepper).toHaveTextContent("01 Rename alpha");
    // The part's name is a menu of all the parts.
    await stepper.getByRole("button", { name: "Choose a part" }).click();
    await page.getByRole("menuitemcheckbox", { name: "02 Rename beta" }).click();
    await expect.element(page.getByRole("heading", { name: "Rename beta" })).toBeVisible();
    await expect.element(stepper.getByRole("button", { name: "Next part" })).toBeDisabled();
    // With the rail open again, the header has no stepper.
    localStorage.setItem("med:guide-rail", "open");
    window.dispatchEvent(new StorageEvent("storage", { key: "med:guide-rail" }));
    await expect.element(page.getByRole("navigation", { name: "Guide" })).toBeVisible();
    await expect.element(stepper).not.toBeInTheDocument();
  });

  test("each page keeps its own sidebar: the guide in Review, the changed files in Changes", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          { title: "Rename alpha", files: ["src/alpha.ts"] },
          { title: "Rename beta", files: ["src/beta.ts"] },
        ],
      },
    });
    const guide = page.getByRole("navigation", { name: "Guide" });
    await expect.element(guide).toBeVisible();
    // Its heading hides it, and a button at the start of the review's header
    // shows it again.
    await guide.getByRole("button", { name: "Hide the guide" }).click();
    await expect.element(guide).not.toBeInTheDocument();
    expect(localStorage.getItem("med:guide-rail")).toBe("closed");
    const showGuide = page.getByRole("button", { name: "Show the guide" });
    await expect.element(showGuide).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => document.activeElement).toBe(showGuide.element());
    // The overview takes the room.
    await expect.element(page.getByRole("region", { name: "Guide overview" })).toBeVisible();

    // Changes keeps its own choice: its sidebar still shows, until hidden.
    await page.getByRole("radio", { name: "Changes" }).click();
    const files = page.getByRole("navigation", { name: "Files and commits" });
    await expect.element(files).toBeVisible();
    await files.getByRole("button", { name: "Hide changed files" }).click();
    await expect.element(page.getByRole("button", { name: "Show changed files" })).toBeVisible();
    await expect.element(files).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(files).toBeVisible();
    expect(localStorage.getItem("med:changes-rail")).toBe("open");
    await page.getByRole("radio", { name: "Review" }).click();
    await expect.element(showGuide).toBeVisible();
    expect(guide.query()).toBeNull();

    // Open holds in a review too narrow for "auto", and the shortcut hides it again.
    await page.viewport(700, 800);
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(guide).toBeVisible();
    expect(localStorage.getItem("med:guide-rail")).toBe("open");
    await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
    await expect.element(guide).not.toBeInTheDocument();
    expect(localStorage.getItem("med:guide-rail")).toBe("closed");
  });
});

describe("reading a version by commit and since the last review", () => {
  test("a later hand-off opens on what is new since you looked, which the Overview and the rail show again", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { controller, savedReads, readVersions } = await mountApp({
      savedReview: true,
      versions: 2,
      since: {
        from: 1,
        to: 2,
        basis: "viewed",
        files: [{ path: "src/alpha.ts", change: "changed", target: "target-1" }],
        moved: ["src/beta.ts"],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    // Opening version 2 marks it read: the next version's "since" starts here.
    await expect.poll(readVersions).toEqual([2]);
    await expect.poll(() => controller.getSnapshot().savedReview?.readVersions).toEqual([2]);
    // It opens on only what changed, and names no version.
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
    await expect.element(page.getByText("What changed since you last looked")).toBeVisible();
    await expect
      .element(page.getByText("Changed only with the base, as after a rebase: src/beta.ts"))
      .toBeVisible();
    // The same target, as only its changes: the diff, its texts, and its comments.
    expect(savedReads).toContain("/api/reviews/saved/targets/target-1/review?since=1");
    expect(savedReads).toContain("/api/reviews/saved/targets/target-1/notes?since=1");
    const rail = page.getByRole("navigation", { name: "Guide" });
    const row = rail.getByRole("button", { name: /^New since you looked, 1 file changed/ });
    await expect.element(row).toHaveAttribute("aria-current", "page");
    // Another row of the rail shows the whole version again, and it stays.
    await rail.getByRole("button", { name: "Overview" }).click();
    await expect.element(overview).toBeVisible();
    await expect.poll(() => controller.getSnapshot().savedSince).toBeNull();
    await overview.getByRole("button", { name: "Show only these changes" }).click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
    await rail.getByRole("button", { name: "Overview" }).click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBeNull();
    await row.click();
    await expect.poll(() => controller.getSnapshot().savedSince).toBe(1);
  });

  test("the Pull request page has no versions note: the review opens on what is new", async () => {
    await mountApp({
      savedReview: true,
      versions: 2,
      since: {
        from: 1,
        to: 2,
        basis: "commented",
        files: [{ path: "src/alpha.ts", change: "changed", target: "target-1" }],
      },
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [],
        conversation: [],
        reviews: [],
      },
    });
    await userEvent.click(page.getByRole("radio", { name: "Pull request" }));
    const live = page.getByRole("region", { name: "Pull request" });
    await expect.element(live.getByRole("heading", { level: 1 })).toBeVisible();
    expect(live.element().textContent).not.toContain("since your last review");
    expect(live.getByRole("button", { name: "Show only these changes" }).query()).toBeNull();
  });

  test("a commit of the range shows the version's comments on its lines, and says how many it cannot show", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { savedReads } = await mountApp({
      savedReview: true,
      rangeCommits: true,
      lens: {
        notes: [
          {
            id: "version-note",
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            text: "From the whole range.",
            createdAt: "2026-09-20T00:00:00Z",
            updatedAt: "2026-09-20T00:00:00Z",
          },
        ],
        hidden: 2,
      },
    });
    await page
      .getByRole("list", { name: "Commits" })
      .getByRole("button", { name: /Add the initial renderer/ })
      .click();
    await expect.element(page.getByText("From the whole range.")).toBeVisible();
    await expect
      .element(page.getByText(/^2 comments are on lines that this commit does not show\./))
      .toBeVisible();
    // The commit's comments come with the version's: the host places them.
    expect(savedReads).toContain(
      `/api/reviews/saved/browsing/${secondCommit}/notes?target=target-0`,
    );
  });

  test("the same commit in Changes shows only its own comments, not the version's", async () => {
    await page.viewport(1500, 900);
    localStorage.setItem("med:changes-rail", "open");
    localStorage.setItem("med:guide-rail", "open");
    const { controller } = await mountApp({
      savedReview: true,
      rangeCommits: true,
      lens: {
        revision: 4,
        notes: [
          {
            id: "version-note",
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            text: "From the whole range.",
            createdAt: "2026-09-20T00:00:00Z",
            updatedAt: "2026-09-20T00:00:00Z",
          },
        ],
      },
    });
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    const commit = () =>
      page.getByRole("list", { name: "Commits" }).getByRole("button", {
        name: /Add the initial renderer/,
      });
    // Changes list the Review's commits: there, a commit is only itself.
    await changesTab.click();
    await commit().click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    // The same commit in the Review has the version's comments too.
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await page
      .getByRole("list", { name: "Commits" })
      .getByRole("button", { name: /Add the initial renderer/ })
      .click();
    await expect.element(page.getByText("From the whole range.")).toBeVisible();
    // Changes come back on that commit, with its own comments only.
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().inReview).toBe(false);
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect.poll(() => controller.getSnapshot().notes?.notes).toEqual([]);
    await expect.element(page.getByText("From the whole range.")).not.toBeInTheDocument();
  });

  test("a comment that meets a newer revision reads the comments again, and the next one saves", async () => {
    const { controller, savedNotes, savedReads } = await mountApp({
      savedReview: true,
      noteConflict: true,
    });
    await expect.poll(() => controller.getSnapshot().notes?.reviewId).toBe("target-0");
    await controller
      .mutateNote({
        type: "add",
        note: { path: "src/alpha.ts", side: "new", line: 1, text: "First try." },
      })
      .catch(() => {});
    await controller.mutateNote({
      type: "add",
      note: { path: "src/alpha.ts", side: "new", line: 1, text: "Second try." },
    });
    await expect.poll(() => savedNotes.map((note) => note.text)).toContain("Second try.");
    expect(savedReads.filter((read) => read.includes("/notes/notes"))).toEqual([]);
  });
});

describe("review guide comments", () => {
  const guide = {
    summary: "Renames the export.",
    segments: [
      {
        title: "Rename alpha",
        files: ["src/alpha.ts"],
        comments: [
          {
            file: "src/alpha.ts",
            line: 1,
            side: "new" as const,
            kind: "risk" as const,
            body: "Callers still import the old name.",
          },
        ],
      },
    ],
  };

  test("a summary shows a diagram and loads an image from the checkout, in the Overview and in a segment", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: ["Retries back off.", "", "```mermaid", "graph LR", "  A-->B", "```"].join("\n"),
        segments: [
          {
            title: "Rename alpha",
            summary: "The new states:\n\n![Retry states](shots/states.png)",
            files: ["src/alpha.ts"],
          },
        ],
      },
    });
    const overview = page.getByRole("region", { name: "Guide overview" });
    await expect.element(overview.getByText("Retries back off.")).toBeVisible();
    await expect
      .poll(() => overview.element().querySelector(".med-md-diagram svg"), { timeout: 5000 })
      .not.toBeNull();
    await userEvent.keyboard("j");
    const image = page.getByRole("img", { name: "Retry states" });
    await expect.element(image).toBeInTheDocument();
    await expect.element(image).toHaveAttribute("src");
    const url = new URL((image.element() as HTMLImageElement).src);
    expect(url.pathname).toBe("/api/markdown/image");
    expect(url.searchParams.get("href")).toBe("shots/states.png");
    expect(JSON.parse(url.searchParams.get("source")!)).toMatchObject({ kind: "worktree" });
  });

  test("Reply opens a box under the agent's comment, and Cancel closes it", async () => {
    await page.viewport(1280, 800);
    await mountApp({ savedReview: true, guide });
    await userEvent.keyboard("j");
    await expect.element(page.getByText("Callers still import the old name.")).toBeVisible();
    const card = page.getByRole("article", { name: /comment at R1, read-only/ });
    await userEvent.click(card.getByRole("button", { name: "Reply" }));
    const box = card.getByPlaceholder("Reply…");
    await expect.element(box).toBeVisible();
    await userEvent.click(card.getByRole("button", { name: "Cancel" }));
    await expect.element(box).not.toBeInTheDocument();
  });

  test("a reply shows under the agent's comment, in its card, and keeps what it answers", async () => {
    await page.viewport(1280, 800);
    const { savedNotes } = await mountApp({ savedReview: true, guide });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: /comment at R1, read-only/ });
    await userEvent.click(card.getByRole("button", { name: "Reply" }));
    await card.getByPlaceholder("Reply…").fill("The callers moved in this change.");
    await userEvent.click(card.getByRole("button", { name: "Reply", exact: true }).last());
    const reply = card.getByRole("article", { name: /^Your reply to/ });
    await expect.element(reply.getByText("The callers moved in this change.")).toBeVisible();
    // The agent's words first, then the reply, in one card.
    const words = card.element().textContent!;
    expect(words.indexOf("Callers still import")).toBeLessThan(words.indexOf("The callers moved"));
    expect(document.querySelectorAll("[data-comment-card]")).toHaveLength(2);
    expect(savedNotes).toMatchObject([
      { line: 1, guideComment: { id: "s1-1", text: "Callers still import the old name." } },
    ]);
  });

  test("a note on the agent's lines follows the agent's comment", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide,
      notes: [
        {
          id: "older",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "A note that names no comment.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    await userEvent.keyboard("j");
    await expect.element(page.getByText("A note that names no comment.")).toBeVisible();
    const cards = [...document.querySelectorAll("[data-comment-card]")];
    expect(cards[0]!.textContent).toContain("Callers still import");
    expect(cards[1]!.textContent).toContain("A note that names no comment.");
  });

  test("the agent's answer shows in the comment's thread, and a comment goes to the agent that Med runs from the comment", async () => {
    await page.viewport(1280, 800);
    const comment = {
      path: "src/alpha.ts",
      side: "new" as const,
      line: 2,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      resolution: "active" as const,
    };
    const { agentMessages } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        { ...comment, id: "ask", text: "Why rename it here?" },
        {
          ...comment,
          id: "answer",
          parentId: "ask",
          text: "The old name hid that it retries.",
          author: { agent: "claude", sessionId: "s1" },
        },
        { ...comment, id: "later", line: 1, text: "Keep the old name exported." },
      ],
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await expect.element(asked.getByText("The old name hid that it retries.")).toBeVisible();
    // The answer names its agent, and only the user's words can be edited.
    await expect.element(asked.getByText("Claude", { exact: true })).toBeVisible();
    expect(asked.getByRole("button", { name: "Edit reply" }).query()).toBeNull();
    await expect.element(asked.getByRole("button", { name: "Delete reply" })).toBeInTheDocument();

    const later = page.getByRole("article", { name: "Comment thread at line R1" });
    await later.getByText("Keep the old name exported.").hover();
    await userEvent.click(later.getByRole("button", { name: "Send to Claude" }));
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["later"] });
    await expect.element(later.getByText("· Sent to Claude")).toBeVisible();
    expect(later.getByRole("button", { name: "Send to Claude" }).query()).toBeNull();
    // The other comment waits for its own send.
    await expect.element(asked.getByRole("button", { name: "Send to Claude" })).toBeInTheDocument();
  });

  test("a reply to the agent's answer goes to the agent with its thread", async () => {
    await page.viewport(1280, 800);
    const comment = {
      path: "src/alpha.ts",
      side: "new" as const,
      line: 2,
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      resolution: "active" as const,
    };
    const { agentMessages, controller } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        { ...comment, id: "ask", text: "Why rename it here?" },
        {
          ...comment,
          id: "answer",
          parentId: "ask",
          text: "The old name hid that it retries.",
          author: { agent: "claude", sessionId: "s1" },
        },
      ],
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await asked.getByText("The old name hid that it retries.").hover();
    // The answer takes a reply, and the box sends it as it saves.
    await userEvent.click(asked.getByRole("button", { name: "Reply", exact: true }).last());
    await expect.element(asked.getByRole("checkbox", { name: "Send to Claude now" })).toBeChecked();
    await asked.getByRole("textbox", { name: "Reply text" }).fill("Then name it fetchWithRetry.");
    await asked.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(() =>
        controller.getSnapshot().notes?.notes.find((note) => note.text.startsWith("Then name")),
      )
      .toMatchObject({ parentId: "ask" });
    // The thread goes by its first comment, with the reply in it.
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: ["ask"] });
    await expect.element(asked.getByText("· Sent to Claude")).toBeVisible();
    const text = asked.element().textContent!;
    expect(text.indexOf("Sent to Claude")).toBeGreaterThan(text.indexOf("Then name it"));
  });

  test("a new comment goes to Claude as it is saved while Send to Claude now is ticked", async () => {
    await page.viewport(1280, 800);
    const { agentMessages, controller } = await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      inbox: { messages: [], owned: ["s1"], drafts: [] },
    });
    const write = async (text: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
      await page.getByRole("option", { name: /Find in diff contents/ }).click();
      await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
      await page.getByRole("button", { name: "Next match" }).click();
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.getByRole("textbox", { name: "Review note text" }).fill(text);
    };
    await write("Rename it.");
    const sendNow = page.getByRole("checkbox", { name: "Send to Claude now" });
    await expect.element(sendNow).toBeChecked();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.find((note) => note.text === "Rename it."))
      .toBeTruthy();
    const sent = controller.getSnapshot().notes!.notes.find((note) => note.text === "Rename it.")!;
    await expect
      .poll(() => agentMessages.at(-1))
      .toMatchObject({ thread: "claude-s1", text: "", noteIds: [sent.id] });

    // Not ticked, it waits for Send in the message box.
    await write("Later.");
    await sendNow.click();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.some((note) => note.text === "Later."))
      .toBe(true);
    expect(agentMessages).toHaveLength(1);
    viewSettings.commentsSendNow.set("on");
  });

  test("a comment has no Send when Med does not run the agent", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      guide,
      notes: [
        {
          id: "ask",
          path: "src/alpha.ts",
          side: "new",
          line: 2,
          text: "Why rename it here?",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
      inbox: { messages: [], elsewhere: { s1: "terminal" }, drafts: [] },
    });
    await userEvent.keyboard("j");
    const asked = page.getByRole("article", { name: "Comment thread at line R2" });
    await expect.element(asked.getByText("Why rename it here?")).toBeVisible();
    expect(asked.getByRole("button", { name: /^Send to / }).query()).toBeNull();
  });

  test("a reply to a comment that a later guide replaced says what it answers", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide,
      notes: [
        {
          id: "reply",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "That was fixed.",
          guideComment: { id: "s1-1", author: "Claude", text: "An earlier comment." },
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: "Comment thread at line R1" });
    await expect.element(card.getByText("Claude: An earlier comment.")).toBeVisible();
  });
});

describe("file references in comments", () => {
  /** A comment's link to src/beta.ts:2 opens the file at that line; the
   * unknown src/gone.ts:4 stays text. */
  async function opensBeta(card: ReturnType<typeof page.getByRole>) {
    const link = card.getByRole("link", { name: "Open src/beta.ts at L2" });
    await expect.element(link).toHaveTextContent("beta.tsL2");
    await expect.element(card.getByText(/src\/gone\.ts:4/)).toBeVisible();
    expect(card.getByRole("link", { name: /gone/ }).query()).toBeNull();
    await link.click();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    const editor = page.getByRole("region", { name: "File editor" });
    await expect
      .poll(() =>
        [...editor.element().querySelectorAll(".med-cited-line")].map((line) => line.textContent),
      )
      .toEqual(["export const workingContents = true;"]);
  }

  test("a Med comment links a path in its text", async () => {
    await mountApp({
      notes: [
        {
          id: "mine",
          path: "src/alpha.ts",
          side: "new",
          line: 1,
          text: "Compare with src/beta.ts:2; src/gone.ts:4 went away.",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "active",
        },
      ],
    });
    const card = page.getByRole("article", { name: "Comment thread at line R1" });
    await expect.poll(() => card.element().textContent).toMatch(/Compare with beta\.tsL2/);
    await opensBeta(card);
  });

  test("the agent's comment links a path in code", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      guide: {
        summary: "Renames the export.",
        segments: [
          {
            title: "Rename alpha",
            files: ["src/alpha.ts"],
            comments: [
              {
                file: "src/alpha.ts",
                line: 1,
                side: "new",
                kind: "risk",
                body: "Callers read `src/beta.ts:2`; `src/gone.ts:4` went away.",
              },
            ],
          },
        ],
      },
    });
    await userEvent.keyboard("j");
    const card = page.getByRole("article", { name: /comment at .*read-only/ });
    await expect.poll(() => card.element().textContent).toMatch(/Callers read beta\.tsL2/);
    await opensBeta(card);
  });

  test("a GitHub comment links a path, and a link to the head's file, but not one to another commit", async () => {
    const at = (id: number, body: string) => ({
      id,
      author: "mira",
      body,
      createdAt: "2026-09-20T00:00:00Z",
      url: `https://github.com/acme/med/pull/7#discussion_r${id}`,
    });
    await mountApp({
      savedReview: true,
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [
          {
            id: 11,
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            startLine: null,
            originalLine: 1,
            comments: [
              at(
                11,
                [
                  "Mirror src/beta.ts#L2; src/gone.ts:4 went away.",
                  `Same as https://github.com/acme/med/blob/${firstCommit}/src/beta.ts#L1-L2,`,
                  `not https://github.com/acme/med/blob/${"b".repeat(40)}/src/beta.ts#L1`,
                  `or https://github.com/other/med/blob/${firstCommit}/src/beta.ts#L2.`,
                  `The guide: https://github.com/acme/med/blob/${firstCommit}/docs/GUIDE.md?plain=1#L1`,
                  "",
                  "```",
                  "src/alpha.ts:1",
                  "```",
                ].join("\n"),
              ),
            ],
          },
        ],
        conversation: [],
        reviews: [],
      },
    });
    const thread = page.getByRole("article", { name: "GitHub thread by mira at R1" });
    await expect.element(thread).toBeVisible();
    await expect
      .element(thread.getByRole("link", { name: "Open src/beta.ts at L1–2" }))
      .toHaveTextContent("beta.tsL1–2");
    // A link to another commit stays a link to GitHub.
    await expect
      .element(thread.getByRole("link", { name: /blob\/b{40}\/src\/beta\.ts#L1$/ }))
      .toHaveAttribute("href", `https://github.com/acme/med/blob/${"b".repeat(40)}/src/beta.ts#L1`);
    // So does a link to another repository; a Markdown file's lines open.
    await expect
      .element(thread.getByRole("link", { name: /github\.com\/other\/med\// }))
      .toBeVisible();
    await expect
      .element(thread.getByRole("link", { name: "Open docs/GUIDE.md at L1" }))
      .toBeVisible();
    // A path in a code block stays code.
    expect(thread.getByRole("link", { name: /alpha/ }).query()).toBeNull();
    await opensBeta(thread);
  });
});

describe("saved reviews", () => {
  test("a thread's Review lists its files and commits, and Changes shows the live changes", async () => {
    await page.viewport(1400, 900);
    const { controller } = await mountApp({
      savedReview: true,
      rangeCommits: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // A Review without a guide opens on the whole diff.
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // Its sidebar lists the files and the range's commits.
    const rail = page.getByRole("navigation", { name: "Files and commits" });
    await expect.element(rail).toBeVisible();
    await expect.element(rail.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const list = rail.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "Whole range" }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: "Whole range" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // Changes are the checkout's live diff: on the base branch, its working
    // changes. Beside their files, they list the commits that the Review covers.
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    expect(controller.getSnapshot().comparison).toEqual({ kind: "working" });
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
    await expect.element(rail).toBeVisible();
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toBeVisible();
    // Its heading hides it, and the choice holds.
    await rail.getByRole("button", { name: "Hide changed files" }).click();
    await expect.element(rail).not.toBeInTheDocument();
    expect(localStorage.getItem("med:changes-rail")).toBe("closed");
    await reviewTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
  });

  test("a pull request's sidebar lists its commits, read ahead so each shows at once", async () => {
    await page.viewport(1400, 900);
    const { controller, requests } = await mountApp({
      savedReview: true,
      rangeCommits: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // The sidebar lists the range's commits at its top, then the files.
    await expect.element(page.getByRole("navigation", { name: "Files and commits" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const list = page.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "Whole range" }))
      .toHaveAttribute("aria-current", "page");
    // While the review is idle, the commits load ahead.
    const commitReads = () =>
      requests
        .filter((comparison) => comparison.kind === "commit")
        .map((c) => "commit" in c && c.commit);
    // They wait for idle time, after the open records the hand-off read.
    await expect.poll(commitReads, { timeout: 5_000 }).toEqual([firstCommit, secondCommit]);
    // A commit picked in the sidebar narrows the Review's diff to it, with no request.
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(list.getByRole("button", { name: /Add the initial renderer/ }))
      .toHaveAttribute("aria-current", "page");
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    await list.getByRole("button", { name: /Improve the review stream/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: firstCommit });
    expect(commitReads()).toEqual([firstCommit, secondCommit]);
    await list.getByRole("button", { name: "Whole range" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    // Changes list the same commits, the ones that the Review covers. A commit
    // picked there shows in Changes, from the read ahead, and All changes
    // comes back to the live diff.
    const changesTab = page.getByRole("radio", { name: "Changes", exact: true });
    await changesTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    expect(list.getByRole("button").elements()).toHaveLength(3);
    await list.getByRole("button", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    expect(controller.getSnapshot().inReview).toBe(false);
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
    expect(commitReads()).toEqual([firstCommit, secondCommit]);
    await list.getByRole("button", { name: "All changes" }).click();
    await expect.poll(() => controller.getSnapshot().comparison).toEqual({ kind: "working" });
    await expect.element(changesTab).toHaveAttribute("aria-checked", "true");
  });

  test("a branch's Changes list its own commits in the page's sidebar", async () => {
    await page.viewport(1400, 900);
    const { controller, requests } = await mountApp({ branchCommits: true });
    await controller.selectComparison({ kind: "working", base: "main" });
    const list = page.getByRole("list", { name: "Commits" });
    await expect
      .element(list.getByRole("button", { name: "All changes" }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: /Improve the review stream/ }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: firstCommit });
    await expect
      .element(list.getByRole("button", { name: /Improve the review stream/ }))
      .toHaveAttribute("aria-current", "page");
    await list.getByRole("button", { name: "All changes" }).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "working", base: "main" });
    expect(requests.filter((comparison) => comparison.kind === "commit")).toHaveLength(2);
  });

  test("a Review whose checkout changed offers a refresh or the live Changes", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp({
      savedReview: true,
      versions: 1,
      drift: true,
    });
    // The thread opens on its Overview; the Review's diff has the notice.
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    const bar = page
      .getByRole("status")
      .filter({ hasText: "The checkout changed after this version of the Review" });
    await expect.element(bar).toBeVisible();
    await bar.getByRole("button", { name: "Show Changes" }).click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(false);
    expect(controller.getSnapshot().comparison.kind).toBe("working");
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Review", exact: true }).click();
    await expect.element(bar).toBeVisible();
    // A refresh captures the worktree again, as a new iteration that matches it.
    await bar.getByRole("button", { name: "Refresh review" }).click();
    await expect.poll(() => controller.getSnapshot().savedTargetId).toBe("target-2");
    await expect.element(bar).not.toBeInTheDocument();
  });

  test("shows GitHub pull request comments apart from local notes; replies and Med comments go into the reader's pending review, which they submit", async () => {
    const comment = (id: number, author: string, body: string) => ({
      id,
      author,
      body,
      createdAt: "2026-09-20T00:00:00Z",
      url: `https://github.com/acme/med/pull/7#discussion_r${id}`,
    });
    const { pullRequestReads, pullRequestWrites, controller } = await mountApp({
      savedReview: true,
      // GitHub as Med reads it after each change: a reply is a draft until
      // the reader submits their review.
      pullRequestWrite: (input, current) => {
        const change = input as { action: string; body?: string };
        if (change.action === "reply")
          return {
            ...current,
            threads: current.threads.map((thread) =>
              thread.id === 11
                ? {
                    ...thread,
                    comments: [
                      ...thread.comments,
                      { ...comment(13, "me", change.body!), draft: true },
                    ],
                  }
                : thread,
            ),
          };
        if (change.action === "submit")
          return {
            ...current,
            threads: current.threads.map((thread) => ({
              ...thread,
              comments: thread.comments.map(({ draft: _draft, ...entry }) => entry),
            })),
            reviews: [
              ...current.reviews,
              { ...comment(42, "me", change.body ?? ""), state: "COMMENTED" },
            ],
          };
        return current;
      },
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [
          {
            id: 11,
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            startLine: null,
            originalLine: 1,
            comments: [
              comment(11, "mira", "Rename `after` to `next`."),
              comment(12, "sam", "Done in the next push."),
            ],
          },
          {
            id: 21,
            path: "src/beta.ts",
            side: "old",
            line: null,
            startLine: null,
            originalLine: 2,
            comments: [comment(21, "mira", "Is this still needed?")],
          },
        ],
        conversation: [comment(31, "sam", "Ready for review.")],
        reviews: [{ ...comment(41, "jordan", ""), state: "APPROVED" }],
      },
    });
    // The title row names the review by its pull request; the browser tab
    // keeps the review's title.
    await expect
      .element(page.getByRole("link", { name: /^Open pull request #\d+: / }))
      .toBeVisible();
    expect(document.title).toBe("Agent review");
    // The thread on the pull request head shows on its line.
    const thread = page.getByRole("article", { name: "GitHub thread by mira at R1" });
    await expect.element(thread).toBeVisible();
    await expect
      .poll(() => thread.element().textContent, { timeout: 10_000 })
      .toMatch(/Rename after to next\..*sam.*Done in the next push/);
    expect(
      thread
        .getByRole("button")
        .elements()
        .map((button) => button.ariaLabel),
    ).toEqual(["Copy thread", "Reply on GitHub"]);
    await expect
      .element(thread.getByRole("link", { name: "Open on GitHub" }))
      .toHaveAttribute("href", "https://github.com/acme/med/pull/7#discussion_r11");
    // A reply goes into the reader's pending review, and shows as Pending.
    await thread.getByRole("button", { name: "Reply on GitHub" }).click();
    await thread.getByRole("textbox", { name: "Reply on GitHub" }).fill("Renamed.");
    await thread.getByRole("button", { name: "Add to review" }).click();
    await expect.poll(() => thread.element().textContent).toMatch(/me\s*Pending.*Renamed\./);
    expect(pullRequestWrites).toEqual([{ action: "reply", thread: 11, body: "Renamed." }]);

    // A Med comment on this version can go there too.
    await controller.mutateNote({
      type: "add",
      note: { path: "src/alpha.ts", side: "new", line: 1, text: "Name it next." },
    });
    const note = page.getByRole("article", { name: "Comment thread at line R1" });
    await note.getByRole("button", { name: "Add to your pending review on GitHub" }).click();
    await expect
      .element(note.getByRole("button", { name: "In your pending review on GitHub" }))
      .toBeVisible();
    expect(pullRequestWrites.at(-1)).toEqual({
      action: "note",
      targetId: "target-0",
      noteId: "saved-note-0",
    });

    // The Pull request page holds the pending review, the conversation, and
    // every thread; opening it reads the comments again. There is no
    // comments button beside the pull request's link.
    expect(page.getByRole("button", { name: /pull request comments?$/ }).query()).toBeNull();
    const reads = pullRequestReads.length;
    await page.getByRole("radio", { name: "Pull request" }).click();
    const view = page.getByRole("region", { name: "Pull request" });
    await expect.element(view.getByText("Ready for review.")).toBeVisible();
    await expect.poll(() => pullRequestReads.length).toBeGreaterThan(reads);
    const text = view.element().textContent;
    expect(text).toMatch(/jordan\s*approved/);
    expect(text).toMatch(/src\/beta\.ts/);
    await expect
      .element(view.getByRole("button", { name: "Show alpha.ts:R1 in the diff" }))
      .toBeVisible();
    const pending = view.getByRole("region", { name: "Your pending review" });
    await expect.element(pending).toMatchTextContent(/1 comment, only you see them/);
    await pending.getByRole("textbox", { name: "Review summary" }).fill("Looks right.");
    await pending.getByRole("button", { name: "Submit comments" }).click();
    await expect.element(pending).not.toBeInTheDocument();
    expect(pullRequestWrites.at(-1)).toEqual({
      action: "submit",
      event: "COMMENT",
      body: "Looks right.",
    });
    await expect.element(view).toMatchTextContent(/Looks right\./);
  });

  test("⌘⇧B shows and hides the review, the pane beside the session", async () => {
    await mountApp({ savedReview: true });
    const pane = page.getByRole("region", { name: "Agent session" });
    const shows = (id: string) =>
      document.querySelector(`[data-pane="${id}"]`)?.checkVisibility() ?? false;
    const press = () => userEvent.keyboard("{Control>}{Shift>}B{/Shift}{/Control}");
    // The session hides at first: hiding the review brings it back, alone.
    await expect.element(page.getByRole("button", { name: "Show agent session" })).toBeVisible();
    await press();
    await expect.element(pane).toBeVisible();
    await expect.poll(() => shows("review")).toBe(false);
    // The review shows beside the session, and hides again.
    await press();
    await expect.poll(() => shows("review")).toBe(true);
    await expect.element(pane).toBeVisible();
    await press();
    await expect.poll(() => shows("review")).toBe(false);
    await expect.element(pane).toBeVisible();

    // An expanded review hides at one press, and the session fills the row.
    await press();
    await expect.poll(() => shows("review")).toBe(true);
    await page.getByRole("button", { name: "Expand review" }).click();
    await expect
      .poll(() => document.querySelector('[data-pane="session"]')?.hasAttribute("inert"))
      .toBe(true);
    await press();
    await expect.poll(() => shows("review")).toBe(false);
    await expect
      .poll(() => document.querySelector('[data-pane="session"]')?.hasAttribute("inert"))
      .toBe(false);
    await expect.element(pane).toBeVisible();
  });

  test("shows Codex review findings read-only, at their lines or in the Codex panel", async () => {
    const finding = (id: string, path: string, line: number, priority: number, title: string) => ({
      id,
      title,
      body: `Because ${title.toLowerCase()}.`,
      priority,
      confidence: 0.9,
      path,
      startLine: line,
      endLine: line,
    });
    const run = (id: string, commit: string, findings: ReturnType<typeof finding>[]) => ({
      id,
      threadId: id.split(":")[0]!,
      repo: "/test/repo",
      commit,
      createdAt: "2026-09-20T00:00:00Z",
      target: "changes against 'main'",
      verdict: "patch is incorrect",
      explanation: "The exporter reads a field that trails do not have.",
      findings,
    });
    await mountApp({
      savedReview: true,
      codexReviews: [
        run("t1:0", firstCommit, [
          finding("t1:0:0", "src/alpha.ts", 1, 1, "Use the existing field"),
          finding("t1:0:1", "src/beta.ts", 40, 3, "Name the constant"),
        ]),
        run("t0:0", secondCommit, [finding("t0:0:0", "src/alpha.ts", 1, 2, "An older finding")]),
      ],
    });
    // The finding of the commit on screen shows on its line, with no way to write.
    const card = page.getByRole("article", {
      name: "Codex finding at R1, read-only",
    });
    await expect.element(card).toBeVisible();
    expect(card.element().textContent).toMatch(
      /Codex\s*P1.*Use the existing field.*Because use the existing field\./,
    );
    expect(card.element().querySelector("textarea, [contenteditable]")).toBeNull();
    expect(document.querySelectorAll("[data-codex-finding]")).toHaveLength(1);

    // The panel holds each verdict, and the findings the diff cannot show.
    await page.getByRole("button", { name: "3 Codex findings" }).click();
    const panel = page.getByRole("dialog", { name: "Codex reviews" });
    await expect.element(panel).toBeVisible();
    const text = panel.element().textContent;
    expect(text).toMatch(/Codex\s*Patch is incorrect.*The exporter reads a field/);
    expect(text).toContain("1 finding shows in the diff.");
    expect(text).toMatch(/src\/beta\.ts\s*R40.*P3.*Name the constant/);
    expect(text).toContain(
      `Lines refer to ${secondCommit.slice(0, 7)}, the commit that Codex reviewed. This comparison shows ${firstCommit.slice(0, 7)}, so they are listed here.`,
    );
    expect(text).toContain("An older finding");
  });
});

test("collapses every file from ⌘K, then expands them again", async () => {
  await mountApp();
  const header = (action: string, path: string) =>
    page.getByRole("button", { name: `${action} ${path}`, exact: true });
  const command = async (name: string) => {
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  };
  await expect.element(header("Collapse", "src/alpha.ts")).toBeVisible();
  await command("Collapse all files");
  await expect.element(header("Expand", "src/alpha.ts")).toBeVisible();
  await expect.element(header("Expand", "src/beta.ts")).toBeVisible();
  // One open file is enough to collapse all again.
  await header("Expand", "src/beta.ts").click();
  await command("Collapse all files");
  await command("Expand all files");
  await expect.element(header("Collapse", "src/alpha.ts")).toBeVisible();
  await expect.element(header("Collapse", "src/beta.ts")).toBeVisible();
});
