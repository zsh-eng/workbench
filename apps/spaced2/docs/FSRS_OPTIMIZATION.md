# Personal FSRS-6 parameters

## 9 November 2026 refit (active)

The active weights were refitted on 9 November 2026 and the maximum interval
raised from 100 to 365 days. The 19 September fit below is kept for history.

Why: grading changed on 16 Sep 2026. Before then Hard was the user's default
pass and Again was almost never pressed; since then Good is the default and
Again is about 8%. The 19 September weights were fitted almost entirely on the
old grading, and they predict the honest reviews worst of the options below.

Data: the Workbench backup's `spaced.sqlite` `reviews` table (undone reviews
already removed), 66,337 reviews to 7 Nov 2026. Same optimizer, time zone and
day boundary as before. The one-off comparison script (`fsrs-refit.py`), its
`compare.json` and the fits are in `optimizer.local/run-2026-11-09/`.

Test: train on reviews before 9 Oct 2026 04:00 SGT, score the 1,187 later
next-day targets. All of them are honest grading. Observed recall 93.3%.

| Weights (lower is better) | Log loss | Brier | Mean predicted recall |
| --- | ---: | ---: | ---: |
| 19 Sep personal (were active) | 0.3223 | 0.0711 | 95.0% |
| FSRS-6 defaults | 0.3072 | 0.0770 | 89.9% |
| **Refit, grades as recorded (adopted)** | **0.3004** | **0.0684** | 95.2% |
| Refit, old-era Hard read as Good | 0.2988 | 0.0686 | 95.1% |
| Refit, old-era Hard→Good and Good→Easy | 0.3051 | 0.0690 | 95.0% |

The adopted refit beats the old weights by 0.0219 log loss (paired bootstrap
95% CI 0.0175–0.0265). Reading old-era Hard as Good scored about the same
(0.0016 better), but the user rejected that reading: Hard means recalled with
effort. The final weights refit all history with grades as recorded. A new
card still starts at about 34–36 days of stability for Hard, Good or Easy,
because the history holds almost no honest first reviews (new cards stopped
in June 2026). The model is still somewhat overconfident. Refit again around
March 2027 when more honest reviews exist.

## 19 September 2026 fit (superseded)

### Status

The 21 fitted weights in `src/lib/review/fsrs6-personal-parameters.ts` are now
active in the production ts-fsrs 5.4.2 scheduler. The migration preserves existing
schedules and uses these weights for future reviews. The 19 September release
was verified after deployment.

The user's account was selected by review volume: 65,269 reviews versus at most
23 for any other account. Other accounts were excluded from training. The user
has authorized using these personal weights as the app-wide client defaults.

## Input and interpretation

- 65,269 source reviews; remove 1,782 reviews marked deleted by Undo.
- 63,487 remaining events across 5,317 reviewed cards. All histories start with
  a New-state event. The account also has unreviewed cards outside this dataset.
- Preserve 270 Manual markers in the export with rating zero. The official
  preprocessing excludes Manual and subsequent targets for those cards, instead
  of treating manual changes as successful recall.
- Keep same-day events in the histories. The official optimizer scores later-day
  recall targets and applies its standard initial-review/outlier filtering.
  The full fit contains 45,696 training targets.
- Use Asia/Singapore and a 04:00 day boundary. Historical travel time zones are
  not recorded, so this is a uniform interpretation of the existing timestamps.
- Again means failed recall; Hard, Good, and Easy mean successful recall. The
  user confirmed that Hard means recall with effort. This matches the training
  interpretation; no rating remapping or refit is required.
- Keep desired retention at 0.9, fuzz enabled, and maximum interval configured
  as 100 days. Do not optimize retention or change due dates as part of this fit.

## Validation

Fit on the earlier 80% of exported events by timestamp, then evaluate the
10,344 eligible later-day targets after that cutoff. Each prediction can use
earlier reviews of its card, but test targets do not train the weights. No
test-target outlier filtering was applied. This is a chronological next-review
prediction check, not a randomized trial of a new review schedule.

| Held-out metric (lower is better) | FSRS-6 defaults | Fitted on earlier history |
| --- | ---: | ---: |
| Log loss | 0.166890 | 0.147451 |
| Brier score | 0.038365 | 0.031471 |

Log loss improves by about 11.6%; Brier score improves by about 18.0%.
Observed recall is 96.56%; mean predicted recall is 91.52% with defaults and
97.85% with the fitted weights. The fitted model remains somewhat overconfident.
These figures do not mean an 11.6% reduction in study time.

After this check, fit all eligible history for the staged final weights.
The full fit has weighted training loss 0.111330 versus 0.147419 for defaults.
That full-fit result is in-sample; the held-out scores above belong to the
earlier-history model, not the final model trained on all data.

An isolated ts-fsrs 5.4.2 installation accepted all 21 rounded weights without
clipping. Previewed all four grades for 7,938 stored cards across all four
states: 31,752 finite outcomes, with unchanged input objects. Missing
`learning_steps` was backfilled to zero for this check only.

A fixed-date new-card Easy example moves from 8 days with defaults to 36 days
with fitted weights. This is illustrative, not a universal interval change.
The snapshot's Good median for Review cards is 97 days with both parameter sets;
many intervals are near the configured maximum.

The check also found ts-fsrs 5.4.2 can produce 101–102 day outcomes despite a
100-day maximum, when it separates the Hard/Good/Easy intervals. This occurs
with both default and fitted weights (1,649 versus 1,652 of the 31,752 outcomes).
Track this during the scheduler upgrade if the cap must be strict; the optimizer
did not introduce it.

## Practical interval comparison

Compare final personal weights with FSRS-6 defaults on the same 5,248 stored
Review cards at 19 September 2026, 04:00 UTC. Disable fuzz in both schedulers
for this comparison only, to isolate the weights. Production keeps fuzz enabled.

| Answer | Shorter next interval | Same interval | Longer next interval |
| --- | ---: | ---: | ---: |
| Hard | 43 | 4,197 | 1,008 |
| Good | 46 | 4,273 | 929 |
| Easy | 925 | 4,278 | 45 |

For Good, this is about 1% shorter, 81% unchanged and 18% longer. Most mature
cards are already near the interval cap, which limits the effect. The weights
do not simply multiply all intervals: Easy can become shorter on existing cards.
Again keeps the same immediate relearning step, but later scheduling can differ.

For a new card, Again stays at 1 minute, Hard at 6 minutes, and Good at 10 minutes.
Easy changes from 8 days to 36 days. These are previews, not new due dates written
to the database. This snapshot compares defaults with final personal weights;
it is not a long-term workload simulation or a comparison with the old FSRS version.
Private reproduction: `optimizer.local/client-check/impact.ts`; results:
`optimizer.local/run/interval-impact.json`.

## Reproduce and activate

Use Python 3.11 and install `fsrs-optimizer==6.5.0` in an isolated environment.
The complete installed dependency versions are saved privately in
`optimizer.local/requirements.lock.txt`.

```sh
optimizer.local/venv311/bin/python scripts/optimize-fsrs.py \
  --database production-backups.local/2026-09-19-refresh/test-data.sqlite \
  --output optimizer.local/run
```

`optimizer.local/run/result.json` contains the full-precision weights, source
checksum, exclusions, fitting settings, and validation metrics. CSV exports,
per-card histories, and validation fixtures stay in the Git-ignored directory.
The client constant rounds weights to four decimal places, as the optimizer
intends. The client validation script and results are in
`optimizer.local/client-check/check.ts` and
`optimizer.local/run/client-validation.json`.

The local scheduler now passes `FSRS6_PERSONAL_PARAMETERS` to
`generatorParameters`. Reload, sync, and Undo checks cover the new fields. Do not refit on every review. Later refits
can replace the weight vector without changing historical logs.

Review order: this report, the client parameter constant, then
`scripts/optimize-fsrs.py` for extraction, chronological evaluation, and fitting.

Sources: [official optimizer and input format](https://github.com/open-spaced-repetition/fsrs-optimizer),
[FSRS-6 algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-6).
