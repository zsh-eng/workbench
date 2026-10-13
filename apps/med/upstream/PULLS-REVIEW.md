# pulls.review provenance

Source: https://github.com/antfu/pulls.review

Revision: `974853a71f1e21b8018e23554687523282cef40b`

License: MIT; the original notice is in [PULLS-REVIEW-LICENSE](PULLS-REVIEW-LICENSE).

## Adapted rules and data

No pulls.review code is copied. Med adapts these parts for an agent that wrote the change and hands it off in a guide (`med review create --guide`):

- The grouping principles and output rules of `packages/core/src/analyze/adapters/llm/prompt.ts`: group by intent, not by directory; use the fewest groups; keep tests apart; order by review priority; place every path once; group by the final change, not by commit; summaries say why over what; notes only where they save the reviewer time; mark critical only what needs extra care. Med rewrites them in its own words in `skills/med/SKILL.md` and `docs/AGENT_INTEGRATION.md`. Med drops nested groups and keeps one comment list per segment: a comment without a line is a file note, and the `risk` kind stands for a critical note.
- The category list of `packages/core/src/types/analyze.ts` (`DiffCategorySchema` and its guide), as the guide's `area` in `src/shared/review-guide.ts`, and the group-level `critical` flag.
- The coverage check of `packages/core/src/analyze/adapters/llm/tools.ts` (`findCoverageIssues`: missing, duplicated, and unknown paths). `src/shared/guide-paths.ts` is a new implementation over Med's path, folder, and glob patterns. Med prints the result as advice after create and update, because the Guide shows unplaced files in a last "Other changes" segment.

The Guide's layout, viewed marks, and commit-by-commit reading are Med's own, after the public pulls.review site.
