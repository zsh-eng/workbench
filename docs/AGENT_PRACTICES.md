Last reviewed: 2026-10-26 (Claude Code changelog up to 2.1.310). Update this file in place; git keeps the history.

Adopted: [REVIEW.md](../REVIEW.md) and the hand-off rules in [AGENTS.md](../AGENTS.md). The rest are recommendations still to decide.

# Agent practices

What Anthropic recommends for building and reviewing with Claude agents, what
this repository adopted, and when to look again. Sources are linked and dated.

Last reviewed 2026-10-26. Window: 26 Sep to 26 Oct 2026. Next check: about 26 Nov 2026.
Dates are publish dates. Claude Code dates are changelog release dates. **Background** means older than the window.
This was read-only research: no repository changed. Links are collected at the end.

## 1. What's new this month

**Models**
- 28 Sep: Sonnet 5.5 becomes Claude Code's default Sonnet (2.1.284) [changelog]. 7 Oct: Haiku 5.5, 1M context (2.1.293) [changelog].
- Model prompting guides (pages carry no date; read 26 Oct) [opus55] [sonnet55] [prompting]:
  - Opus 5.5 runs at `medium` effort by default. To get less thinking, lower effort; that works better than prompt text.
  - A turn that ends with text only is a report, not proof the task is done.
  - Time budgets make agent teams finish sooner.
  - Sonnet 5.5 at `low` effort can skip verification. At `xhigh` and `max` it starts its own reviewer subagents.
- Background: Opus 5.5 launched 22 Sep [opus55-launch]. Fable 5.1 launched 1 Sep [fable51].

**Claude Code 2.1.284–2.1.310** [changelog]
- 30 Sep (2.1.286): a project or user skill named `verify` runs before each commit, except docs-only and tests-only commits [skills].
- 2–8 Oct: path-scoped `.claude/rules` and nested CLAUDE.md now load on Write/Edit (2.1.288) and on Bash reads with `cat`, `head`, `sed -n` and `grep` (2.1.293).
- 5–8 Oct: `/code-review --max-findings` (2.1.288). At medium effort on Opus/Sonnet 5.5, the review also reports cleanup and CLAUDE.md-convention findings (2.1.290). Re-reviews count the earlier findings still open (2.1.295).
- 6 Oct: the Agent tool takes `effort` (2.1.292). 8 Oct: hooks can set `onFailure: "block"`, so a hook that crashes blocks the action (2.1.295).
- 14 Oct: `claude plugin eval --disallow-tools` (2.1.299). A run that ends in an API error now scores 0 and fails the suite (2.1.300).
- 15 Oct: Code Review is generally available on Team and Enterprise plans [cr-ga]. Reviews take 6–10 minutes, and there are Quick, Standard and Deep levels for each repository (2.1.304).
- 16 Oct (2.1.302): fork subagents are on by default in `-p`, the SDK, the desktop app and VS Code. A fork inherits the parent's whole conversation [subagents].
- 21 Oct (2.1.307): OpenTelemetry `claude_code.safety_event` for every tool call that was stopped, prompted or sent back. `@claude review stop` ends a review subscription.
- 22 Oct (2.1.309): a nested CLAUDE.md over the size limit loads only its start. `claude ultrareview` needs workspace trust.
- Background: `/doctor prompt-audit` (2.1.283, 25 Sep), `/skill-doctor` (2.1.252), `claude plugin eval` (2.1.269).

**Anthropic posts**
- 13 Oct, "Redesigning source control" [scion]:
  - merges went from about 2,500 a day to more than 30,000;
  - they have no merge queue at agent scale and test after merge and before deploy instead;
  - people review intent and "tell Claude 'no'".
- 15 Oct, "How the Claude Code team does code review" (Osmani, Westlee Lunt, Wang) [cr-blog]. Addy Osmani reshared it on X on 26 Oct [addy].
  - Already read: layers; pre-PR proof plus a fresh-context review; a short CLAUDE.md; REVIEW.md; Important / Nit / Pre-existing; a 3-round cap with diff-only re-review; tiers set by the change; incidents as evals; explainers.
  - Results: pass after one round went from 65% to 78%. Mean reviews to pass went from 2.08 to 1.32.
- 21 Oct: Claude Security scans continuously and tracks fixes (Enterprise beta) [security-scan].
- 22 Oct, Diane Sarkis on folding subagents into the main loop [fold]. Already read: progressive disclosure, evals first, rules in tools, fold one at a time, `/claude-api build-eval | prompt-audit | hillclimb | cost-optimize`.
  - The companion repo [kit] works in three steps: Measure, Combine, Fold.
  - It keeps a subagent for parallel fresh-context work, independent verification, or work that reads far more than the main agent needs afterwards. "Start with one loop."
  - It is a reference only, unmaintained.
- 23 Oct, Claude Duet safety [duet]:
  - approvals show the action, destination and content;
  - credentials never reach the model;
  - the agent has its own User-Agent;
  - a task list shows what it does.
- 26 Oct: Katelyn Lesse (head of platform, Anthropic), "The new set of problems for engineers to solve" [lesse]. Read in full on 27 Oct. Multiagent systems need engineers to solve four problems:
  - **infrastructure**: agents are isolated, stateful, single-instance workloads that sit idle while they wait for tools, models, other agents or people, which Kubernetes wasn't designed for;
  - **identity and access**: authentication is mostly solved (workload identity, short-lived certificates), but authorization isn't. Hard questions: how a person meaningfully consents to what agents do on their behalf over weeks; how to tell an agent's action from the person's; how one agent trusts a request from another;
  - **security and isolation**: a compromised agent can pass injected instructions to other agents and into memory that later agents trust, so run actions in strongly isolated sandboxes to limit the blast radius;
  - **monitoring and halting**: OpenTelemetry tracing across agents that no agent can modify, and kill switches that stop the whole system at once and cut off its credentials. Persistence can look like malice (repeated tries at a domain off the allowlist).
- Docs updated at unknown dates:
  - best practices adds `/goal` and Stop-hook gates, and warns that adversarial reviewers over-report [bp];
  - the memory page sets a target of under 200 lines per file [memory];
  - the security-guidance plugin reviews code on each edit, each turn and each commit, using hooks [secguide].

## 2. Recommendations

### (a) Workbench AGENTS.md (CLAUDE.md symlinks to it)
The file is 71 lines, well under the 200-line target [memory]. Keep the symlink: the docs say Claude reads the content once, and Code Review reads CLAUDE.md. Test for every line: "Would removing this cause Claude to make mistakes?" [bp].

| Lines | Change | Why (source) |
|---|---|---|
| 9–11 | Cut the three "Follow its AGENTS.md" lines. The list is also stale: it leaves out med, med-site, sync-server, podcast-lab, ios. Keep only "`packages`: do not import app code." | A subdirectory's AGENTS.md loads when Claude reads a file there [memory]. Whether Codex does the same isn't confirmed, so keep one pointer line if Codex starts at the root. |
| 17–19 | Move the Dependencies pointer to `.claude/rules/dependencies.md` with `paths: ["**/package.json"]`. Keep the Architecture pointer, because it depends on the topic, not the path. | Path-scoped rules now load on edits and reads (2.1.288, 2.1.293) [changelog]. |
| 25 | Add a PreToolUse hook that denies `npx tsc` with "use `bun run build`". Keep the line for Codex. | "Put guardrails in hooks" [features]. |
| 27–31 | Move the checks into `.claude/skills/verify/SKILL.md`: the per-app check matrix, browser or simulator runs for interaction changes, traces for performance claims, and open checks reported. Then cut "Documentation-only changes need … not a build". | Since 2.1.286 a skill named `verify` runs before each commit and skips docs-only commits by itself [skills]. |
| 33–34 | Keep the line. Add a PreToolUse hook that asks before `wrangler deploy`, `bun run deploy*` and `--remote` migrations, with `onFailure: "block"`. | Auto mode is the default (2.1.283+), and its classifier isn't a guarantee [bp]. |
| 44–46 | The `zz-*` ban was ignored: a `zz-probe.html` from the reader-highlight-debug worktree was open in the browser pane today. If it happens again, add a hook that blocks writes to `zz-*`. | "If Claude already does something … convert it to a hook" [bp]. |
| 47–50 | Cut the background/timeout lines and "Batch independent file reads" only if an A/B run shows no change (see f). | Claude Code's own system prompt covers parallel calls and background commands. |
| new | Add: "When you review a diff, read REVIEW.md first." | The local `/code-review` follows CLAUDE.md but doesn't read REVIEW.md [cr-local]. Untested: check in one run that it opens the file. |

Keep the style lines (3–5), the test design rules and the process cleanup rules. Codex reads this file too, and `/code-review` checks against the test design rules (2.1.290).

### (b) REVIEW.md for workbench (paste at the repo root, then check the paths)
Code Review reads REVIEW.md from the base branch, never from the PR. It honours exclusions and Nit caps only from a protected default branch [cr-custom].

```markdown
# Review instructions

Tag each finding Important, Nit or Pre-existing, with a file:line citation.
Claims about behaviour cite the source, not names. Start the summary with
the counts ("2 Important, 1 Nit, 0 Pre-existing") or say "Nothing to fix."

## What Important means here
- Lost or corrupted user data: highlights, notes, reading progress, card history.
- Sync or migration breaks: client and server that can't talk, a migration
  that isn't backward compatible, a sync payload changed on one side only.
- Production names, bindings, data, secrets or tokens in code, fixtures or tests.
- A deploy, remote migration or production config change made as a side effect.
- A behaviour the hand-off claims but no check exercises (no browser or
  simulator run for an interaction change, no trace for a performance claim).
Style, naming and refactors are Nit at most.

## Cap the nits
Report at most 3 Nits.

## Do not report
- What `bun run build` and lint already catch.
- `bun.lock`, build output, screenshots and clips, `apps/med/docs/explorations/`.

## Always check
- `packages/` does not import app code.
- Dependency changes follow docs/DEPENDENCIES.md and are declared by their owner.
- Data, caching, sync and performance changes keep docs/ARCHITECTURE.md invariants.
- Tests follow AGENTS.md "Test design"; no `zz-*` probes are left behind.
- For changes under `**/migrations/`, `wrangler*.jsonc` or deploy scripts,
  state the production effect in the summary.

## Re-reviews
Review only the diff since the last review. Don't repeat a posted finding.
Name the bug class so every instance gets fixed. After 3 rounds, say so and
ask the author to reconsider the approach.
```

### (c) Coordinator workflow
- **Subagents vs one loop.** Parallel worktree implementers and a separate critic meet two of the kit's reasons to keep a subagent: parallel fresh-context work and independent verification [kit].
  - Fold "think" and "propose" into the implementer's own context. Keep "critique" separate and fresh.
  - Change one thing at a time and compare on evals [fold].
- **Agent type.** Since 2.1.302, desktop subagents are forks by default, and a fork inherits the coordinator's whole conversation, which adds cost and bias.
  - Spawn implementers and critics as fresh agents with self-contained briefs.
  - Use forks only for side questions that need the coordinator's context [subagents].
- **Effort.** Set it for each agent (2.1.292).
  - Opus 5.5 at `medium` matches or beats Opus 5 at `high` on coding. Use `high` for hard tasks.
  - Keep `xhigh` and `max` for gains you have measured [opus55].
- **Briefs.** Name the completion condition and the proof you want. Add a time budget line such as `elapsed 340s / 1200s`: Opus 5.5 paces to it. Keep your own timeout [opus55].
- **"Done" needs proof.** A subagent's final message is a report.
  - Check its proof block: the commands with their output, or screenshot and clip paths.
  - If items are still open, send one "continue with X" message. Stop after 2–3 automatic continuations [opus55].
- **Verify once per batch on preview.** Keep this. It matches Anthropic's choice of tests after merge and before deploy over a merge queue [scion]. When a batch fails, find the bad worktree by bisecting the merges before you fix anything.
- **Review rounds.** Round 1 is a full fresh-context review against the plan. Later rounds read only the new diff and never repeat a finding.
  - Cap at 3 rounds, then reconsider the approach. Track rounds-to-pass [cr-blog].
  - Ask critics for correctness and requirement gaps only, because reviewers asked to find gaps over-report [bp].
- **Risk tiers, set by the changed paths, not by the agent** [cr-blog]:
  - **Low**: docs, copy, Debug-only experiment tracks, additive changes behind a flag. Merge to preview once checks are green; you read the explainer.
  - **Medium**: ordinary product changes, caching, shared `packages/elements` sheets and motion, Med's CLI. You read the diff once.
  - **High**: `**/migrations/`, `apps/spaced2/scripts/*migration`, `packages/local-sync`, `wrangler*.jsonc`, deploy scripts, auth and tokens. These get a Deep review (or `/code-review ultra`) plus your OK on the exact commit, and Med marks the segment `"critical": true`.
  - Deploys need your OK at every tier. An agent's approval never counts as yours, and an OK covers one commit only.

### (d) Med's agent docs
- **Now:** SKILL.md is 193 lines and AGENT_INTEGRATION.md is 630. A loaded skill stays in context, so "every line is a recurring token cost. State what to do, not how or why" [skills].
- **Target SKILL.md: about 60–80 lines** covering the hand-off path only:
  - record the start, then run `med review repos`;
  - the six segment rules;
  - the three `create` variants;
  - fix the guide check, paste the link, wait.
  - Move tabs, history, find/adopt and the manifest into `skills/med/reference.md`, loaded on demand.
  - Split the skill in two (hand-off, adopt) only if an eval shows it triggers wrongly.
- **`med docs agents` at about 150 lines.** Move "Review in Med", "Send comments" and the limit details (lines 477–563 and 612–630) to USAGE.md: agents don't need the UI walkthrough.
- **Move rules into CLI checks, then delete the prose** ("rules in tools") [fold]:
  - warn when a title isn't 2–4 words or includes the repo name, "review" or "changes";
  - when `--working` finds files that were dirty before the session started, warn and suggest `--paths` (Med knows when the session started);
  - resolve `--repo` set to a subfolder up to the repository root;
  - when a repo isn't registered, the error says to ask the user before running `med add`;
  - limits (40 segments, 200 comments, 500 files) become plain errors;
  - show `turn.checks`, which Med already reads from the transcript, as the proof, instead of asking agents to paste output.
- Run `/doctor prompt-audit apps/med/skills/med` after each edit [memory].

### (e) Med's suggestion pack (opt-in, one copyable skill each)
Ship it as a skills-directory plugin, so the user can copy one skill or evaluate the whole set. Keep each skill under 40 lines and each description short: every model-invocable description costs context on every turn [features].

| Skill | One-line description | Source |
|---|---|---|
| `proof` | Before handing off, list each check you ran with its command and result (tests, build, screenshot or clip path) and name any check you didn't run. | [bp], [cr-blog] layer 1 |
| `fresh-review` | Review a finished diff in a fresh, non-fork subagent against the plan; report only gaps in correctness or stated requirements. | [bp] "adversarial review" |
| `findings` | Tag each finding Important, Nit or Pre-existing with file:line evidence; open with the counts, or say "Nothing to fix". | [cr-blog], [cr-custom] |
| `review-rounds` | On re-review, read only the new diff, don't repeat findings, name the bug class, and stop after 3 rounds to question the approach. | [cr-blog] |
| `risk-tier` | Set the tier from the paths the change touches and state the approvals it needs; an agent's approval never counts as a person's. | [cr-blog] |
| `explainer` | Explain the change before the diff: why it exists, what to check first, and a diagram if it helps; put segments in review order. | [cr-blog] explainers |
| `generated-files` | Name generated and mechanical files (lockfiles, codegen, snapshots) so reviewers skip them and the guide puts them last. | [cr-custom] "Do not report" |
| `incident-eval` | When a merged change causes a bug or a revert, save that change and its fix as an eval case for the reviewer. | [cr-blog] |

Also offer a `verify` template, but never install it by default. The name `verify` makes it run before every commit (2.1.286) and could clash with the user's own skills.

### (f) Evals
- **Instruction files.**
  - Run `/doctor prompt-audit` monthly, and `/context` after each edit to confirm the file loaded [memory].
  - A/B test: take 5–10 past prompts where a rule mattered. Run them with `claude -p` in two worktrees, one with the old AGENTS.md and one trimmed.
  - Grade each transcript with a regex: did it run `npx tsc`, create a `zz-*` file, add unit tests? Keep a line only if removing it changes what Claude does.
- **Skills.** Run `/skill-doctor` to find unused and costly skills [skills].
  - `claude plugin eval` runs each case 3 times with the plugin and 3 times without, and reports the difference, Δ [evals].
  - Grade triggering with `tool_used: Skill`, and include prompts that should not trigger the skill.
  - For Med, use regex graders on the `med review create` line: `--paths` when files were already dirty, `--base <start>` on main, `--merge-base` on branches. Med's own guide check is a free, deterministic grader.
  - Use `--disallow-tools Agent`, and `--judge-model sonnet` for `llm` graders. Start with about 10 cases [kit].
- **Reviewer (incidents as evals)** [cr-blog]:
  - The last 400 commits include 32 fix/revert commits. Pick about 10 bugs you can confirm, replay the diff that introduced each one, and check whether the reviewer finds it.
  - Add known-clean diffs to count false alarms.
  - Score every change to REVIEW.md, the critic brief or the model. Keep a change only if recall rises without more false alarms. Track rounds-to-pass.
  - In Med, let the user tag each finding fixed, wrong, intentional or didn't matter. That is the post's noise measure, and the tags can be exported as eval data.

### (g) Security
Lesse's post [lesse] is about securing and controlling large multiagent systems, not about how to work with agents. Most of it is out of scope for one person with a few local agents (fleet infrastructure, tracing across agents, agents trusting each other). Three points apply here:
- **Memory poisoning.** Agents write files that later agents trust: AGENTS.md, REVIEW.md, the vault's `agent/` notes. Text from another agent, a hand-off or a fetched page is data, not instructions. Review agents' writes to these files like code; repo files get this from commit review, vault notes don't yet.
- **Narrow credentials.** Give an agent's credential the least it needs, as the `wb arctic save` backup scope does (it can add a link and nothing else). An agent's approval never counts as yours, and an OK covers one commit.
- **One stop for everything.** Write down one command that stops every running agent and its servers. `med thread close` keeps the agent running, so Med has none today. Low priority at our scale.

Also kept: the OpenTelemetry `safety_event` and `tool_decision` events (2.1.301, 2.1.307). An agent can write its own transcript, and Med reads transcripts, so treat a transcript as the agent's account, not a tamper-proof trace.

## 3. What to drop (prompt-audit style)
- **Emphasis on many lines** (ALL-CAPS, IMPORTANT, MUST, NEVER). "If you emphasize many lines, none of them stands out." Use emphasis on one line, and only after Claude skipped it [bp].
- **"Think carefully" or "step by step".** Thinking is always on in Opus 5.5 and effort is the control. Removing such lines made chat replies start sooner, with no clear loss in quality [opus55].
- **Asking for reasoning in the reply.** It can trigger `reasoning_extraction` refusals. Ask for a short explanation or a summary of the actions taken instead [opus55].
- **Anti-laziness lines:**
  - "be thorough", "if in doubt use X" and "always use subagents" have caused overtriggering since the 4.6 models;
  - Opus 5 delegates readily;
  - Sonnet 5.5 at `xhigh` adds its own review rounds [prompting] [sonnet55].
- **"Keep updates brief" and "hold findings until the end".** Current models already report plainly. Fable 5.1 writes too few updates and has to be asked for them [prompting].
- **Rules the harness already applies:**
  - "read AGENTS.md", and "follow the nested AGENTS.md";
  - a SessionStart hook that prints AGENTS.md (it adds a second copy) [memory];
  - "run tests before commit", once `verify` exists.
- **Over-specification:** file-by-file layouts, tutorials, and anything Claude can derive from the code. `/doctor` proposes these cuts [bp].
- **The old generic "avoid over-engineering" block.** Use the model-specific scope paragraph (Fable 5.1, Sonnet 5.5), and only if you actually see extra changes. Test before swapping [prompting].
- **API-only settings (anything Med builds on the API):** `budget_tokens` returns a 400 error on 4.7 and later; prefill is gone since 4.6; Opus 5.5 rejects `thinking: disabled` [prompting] [opus55].

## 4. How to keep this current
- **One file, updated in place:** this file (`docs/AGENT_PRACTICES.md`), with its "Last reviewed" line. Git keeps the history.
- **Sources to check:** [changelog], [articles], [engineering], the model table in [prompting], the [cr-custom] and [evals] docs, the anthropics GitHub org sorted by last update, and X posts by staff who state practice.
- **Monthly check (about 30 minutes):** run it as a Claude Code scheduled task (by the user's decision, Med doesn't schedule).
  1. Read the changelog from the last version reviewed, 2.1.310.
  2. Scan both article indexes for new dates, and check the model table.
  3. Run `/doctor prompt-audit`, `/skill-doctor`, the reviewer eval and the Med skill eval.
  4. Update this file in place, and propose AGENTS.md edits as a reviewed change.
- **Update early when:**
  - a new model appears in the prompting table, or the default model changes;
  - a Claude Code release adds a convention that replaces a rule (as `verify` and the AGENTS.md auto-load did);
  - a rule is broken twice (make it a hook);
  - a revert or incident happens (add a reviewer eval case);
  - the reviewer's score falls or rounds-to-pass rises;
  - `/skill-doctor` shows a skill that is never invoked;
  - the Code Review check run says REVIEW.md wasn't applied.

## Not confirmed
- **Katelyn Lesse's post:** the first version of this file summarised it before anyone had read it (WebFetch returned 402). It was read in full in a browser on 27 Oct, and the summary above comes from that text. Posted 26 Oct, 02:19 UTC.
- **Addy Osmani's post:** the date (26 Oct, 06:27 UTC) comes from the post ID. The content was matched to the blog post, which is dated 15 Oct (claude.com lists it as 16 Oct).
- **Staff posts:** none from Boris Cherny or Cat Wu turned up in the window. The "2–3x" verification quote is background (Jan 2026).
- **Changelog 2.1.297–2.1.298 (10–13 Oct):** only their bug-fix lines were readable; I couldn't see the Added and Changed sections.
- **Undocumented:** whether `/code-review` loads `.claude/rules` or opens REVIEW.md when CLAUDE.md tells it to; how Codex loads nested AGENTS.md.
- **Your context:** `apps/med/AGENTS.md` doesn't exist; Med's agent guide is `docs/AGENT_INTEGRATION.md` plus `skills/med/SKILL.md`. AGENT_INTEGRATION.md has 630 lines, not 656.

[changelog]: https://code.claude.com/docs/en/changelog
[skills]: https://code.claude.com/docs/en/skills
[subagents]: https://code.claude.com/docs/en/sub-agents
[bp]: https://code.claude.com/docs/en/best-practices
[memory]: https://code.claude.com/docs/en/memory
[features]: https://code.claude.com/docs/en/features-overview
[cr-local]: https://code.claude.com/docs/en/code-review-local
[cr-custom]: https://code.claude.com/docs/en/code-review-customize
[evals]: https://code.claude.com/docs/en/plugin-evals
[secguide]: https://code.claude.com/docs/en/security-guidance
[prompting]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
[opus55]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
[sonnet55]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5
[fable51]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
[opus55-launch]: https://www.anthropic.com/claude-opus-5-5
[cr-ga]: https://claude.com/resources/articles/code-review-is-now-generally-available
[cr-blog]: https://claude.dev/blog/solving-code-review-at-anthropic/
[addy]: https://x.com/addyosmani/status/2114604912520921136
[lesse]: https://x.com/katelyn_lesse/status/2114542280535318557
[scion]: https://www.anthropic.com/research/redesigning-source-control
[fold]: https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop
[kit]: https://github.com/anthropics/single-agent-loop-kit
[security-scan]: https://claude.com/resources/articles/claude-security-now-scans-continuously-and-tracks-fixes
[duet]: https://claude.com/resources/articles/claude-duet-safety-privacy-and-security
[articles]: https://claude.com/resources/articles
[engineering]: https://www.anthropic.com/engineering
