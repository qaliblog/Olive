# Final dataset report

Measured from the pipeline that produced the committed files:

```
node scripts/generate.js      # template records
bun  scripts/executed.js      # real-execution records
node scripts/validate.js      # exit 1 on any rejection
node scripts/deduplicate.js
node scripts/split.js
node scripts/statistics.js
node scripts/export.js
```

Every number below comes from `reports/statistics.json`, `datasets/processed/split-manifest.json` and
`datasets/processed/export-manifest.json` after that run. No number is estimated by hand.

## Counts

| Metric | Value |
| --- | --- |
| Records generated | 479 |
| Records validated | 476 |
| Records rejected by the validator | 0 |
| Duplicates removed | 3 |
| Rejection + duplicate rate | 0.63% |
| Template records (`source.kind = template`) | 376 |
| Real-execution records (`source.kind = execution`) | 100 |
| Distinct executed trajectories | 19 |

Previous state was 455 validated: 376 template and 79 execution records. The 21 new execution records come from five
added scenarios (see "What is real here"), not from new template variants.

## Category distribution

| Category | Records |
| --- | --- |
| requirement_extraction | 74 |
| error_recovery | 55 |
| intent_understanding | 53 |
| task_planning | 53 |
| file_reading | 49 |
| file_editing | 34 |
| project_structure | 30 |
| code_generation | 25 |
| dependency_installation | 22 |
| file_creation | 20 |
| diagnostics | 17 |
| test_execution | 13 |
| completion_verification | 13 |
| task_resumption | 10 |
| task_state_update | 8 |

Growth since the previous report: completion_verification 9 → 13, task_resumption 6 → 10, dependency_installation
18 → 22, file_creation 19 → 20, error_recovery 50 → 55. Diagnostics fell 19 → 17 only because two duplicate template
records were removed this run.

## Language distribution

| Language | Records |
| --- | --- |
| en | 368 |
| fa | 94 |
| mixed | 14 |

The mixed count doubled from 7. The new mixed records are not translations of English ones: they mix Persian
instructions with English identifiers, command names and tool output exactly where a real bilingual session does.

## Tool distribution

| Tool | Calls | Phase 1 | Development target |
| --- | --- | --- | --- |
| read_file | 137 | 130 | — |
| project_structure | 73 | 72 | — |
| list_directory | 60 | 58 | — |
| write_file | 38 | 31 | 60 |
| edit_file | 38 | 26 | 60 |
| run_tests | 27 | 9 | 60 |
| install_dependencies | 20 | 11 | 60 |
| inspect_diagnostics | 16 | 8 | 60 |
| run_shell | 12 | 4 | 60 |
| search_code | 10 | 1 | 60 |
| find_symbols | 9 | 1 | 60 |

440 recorded calls in total. The eight underrepresented tools went from 91 calls to 170 (1.87x), and the three dominant
tools from 74% to 61% of all calls. The skew is reduced, not fixed: every rare tool is still below its target.

## Coverage against the phase targets

| Area | Count | Target |
| --- | --- | --- |
| intent | 127 | 200 |
| planning | 53 | 200 |
| tool selection | 79 | 300 |
| tool execution | 106 | 300 |
| task state | 18 | 200 |
| coding | 79 | 300 |
| debugging | 55 | 200 |
| verification | 26 | 100 |
| Persian | 94 | 200 |
| mixed language | 14 | 50 |

These are development targets, not quotas. Nothing was padded to hit them; every shortfall above is real.

## Completion and answer shape

| Field | Records |
| --- | --- |
| `completion = continue` (a tool call) | 436 |
| `completion = done` (report after verified work) | 35 |
| `completion = blocked` (question or refusal) | 5 |
| `kind = tool_call` | 436 |
| `kind = text` | 40 |

Four of the five `blocked` records carry a real failed tool result in their own history (`run_tests`
`command-failed`, `inspect_diagnostics` `command-failed`, and one `read_file` `not-found` plus `search_code` `no-match`
pair); the fifth (`no_verification.fa.0007`) blocks because no verification ran at all. None of them is blocked merely
because a sentence said so.

## Duplicate and rejection statistics

- 3 duplicates removed (1 project_structure, 2 diagnostics), all exact fingerprint matches. Each is recorded in
  `datasets/rejected/rejected-duplicates.jsonl`.
- 0 validator rejections in the committed corpus. Rejections met during this phase were fixed at the source: two mixed
  records whose report sentence was a single-language fallback, one report step that claimed completion while a real
  install failure remained in the state, and one fixture whose test script could not run at all (see below). The
  language, honesty and completion checks were not relaxed.

## Correction: every recorded test run is now a real one

The executed fixtures declared `"test": "node --test test/"`. On this Node build (v22.23.4) a bare directory argument is
resolved as a module path, so that script failed with `Cannot find module '<fixture>/test'` before any test ran. The
effect on the corpus was silent: no execution record could show a passing suite, and narration that described a passing
run contradicted the tool result sitting next to it.

The fixtures now name their test file (`node --test test/cli.test.js` and so on). Re-running the pipeline produced
**11 passing and 7 failing `run_tests` calls, all from real processes**: the failing ones are the deliberate
before-the-fix runs (`not ok 1 - greets the given name`, `Could not find 'test/absent.test.js'`) and the passing ones are
the same scenario after the edit under test. An audit script that compares each `run_tests` result with the sentence in
the same record now reports 0 inconsistencies in all 100 execution records.

## Split statistics

| Split | Records | Groups |
| --- | --- | --- |
| train | 309 | 115 |
| validation | 54 | 19 |
| test | 57 | 22 |
| held-out | 56 | 20 |
| total | 476 | 176 |

Grouping key: `(project, generator family, trajectory, language)`.

## Leakage verification

`split-manifest.json` reports `overlapping_groups: 0` and `overlapping_records: 0`, computed by taking the union of
group keys per split and comparing every pair. `olivellm/test/split-groups.test.js` independently re-derives the
assignment and asserts: no group in two splits, every record in exactly one split, determinism across two runs,
category representation in validation and test, and that no held-out id appears in train, validation or test.

The previous splitter used `sha1(id) % 100`, so two records generated from the same project and generator family could
land on opposite sides of the boundary. That is no longer possible.

## Exported volume

| Split | Records | Rendered tokens |
| --- | --- | --- |
| train | 309 | 415,360 |
| validation | 54 | 71,078 |
| test | 57 | 82,211 |
| held-out | 56 | 75,037 |

Preference pairs: 25. Held-out evaluation cases: 56, plus three derived suites (tool calling, coding, multilingual) and
a deterministic 71-case Colab subsample.

Prompt+answer estimate across the whole corpus: 227,358 tokens (average 478, median 426, p95 746, max 1,433).

## What is real here

- 100 records carry results produced by `packages/core/src/olive/tools.ts` running against a temporary fixture
  workspace: real file reads, real edits, real `node --test` runs (including failures and the exit codes that go with
  them), real `npm` installs, real `node --check` diagnostics, real `not-found`/`no-match`/`command-failed` errors, and
  real recovery afterwards.
- The five scenarios added in this phase cover the gaps the last report named:
  - `question_missing_file` — the objective asks for a file the project does not contain. The agent lists, reads a
    missing path, searches, and asks a `QUESTION:` instead of inventing a changelog. First `blocked` record in the
    corpus whose cause is a genuine `QUESTION:` stop rather than a failed tool call.
  - `resume_after_interrupt` — starts from a durable state a previous run left behind (three completed steps, one file,
    one recorded test failure, `next: "fix the failing tests"`), then reads, edits, runs the suite and reports.
  - `mixed_install_recovery` — a Persian objective, a genuinely missing npm script, a second install that works, and a
    passing suite afterwards.
  - `mixed_symbol_lookup` — Persian question about where a function lives and who calls it, answered from the symbol
    index and a real code search without a single edit.
  - `persian_tests_recovery` — a Persian failing-test session: run, read, edit, re-run, report.
- The remaining 376 are template-generated from project archetypes. They are structurally valid and copied from real
  file contents, but they are not observed agent behaviour.

## Limitations and known quality problems

1. **Coverage is still thin exactly where it matters.** Task state (18), verification (26) and mixed language (14) are
   the areas a tool-calling model needs most, and they are the smallest.
2. **Trajectories are short and scripted.** Eleven scenarios of 3-8 steps each. They teach the shape of a verified run
   (inspect → change → diagnose → test → report), not the long tail of real debugging.
3. **Assistant text is authored, not sampled.** The actions and results in executed records are real; the one-line
   narration next to them is written by the generator. This is stated in `source.kind = "execution"` and in each
   record's `validation.notes`.
4. **Template phrasing repeats.** Deduplication removes near-identical records, but the same sentence patterns appear
   across projects. A model trained on this may learn the template's voice.
5. **No native-speaker review** of the 94 Persian records.
6. **The dominant tools remain dominant.** `read_file`, `project_structure` and `list_directory` are 61% of calls
   because the agent prompt itself says "inspect before editing"; that is realistic but it biases selection.
7. **Evaluation suites are small** (11-24 cases per suite) and derived from the same held-out groups, so per-suite
   numbers carry wide uncertainty. The held-out set changed in this phase, so the published v4 instruction measurement
   is not comparable with a run on the new suite; the baseline has to be re-measured before any comparison.
