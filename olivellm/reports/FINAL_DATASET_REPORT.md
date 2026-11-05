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
| Records generated | 459 |
| Records validated | 455 |
| Records rejected by the validator | 0 |
| Duplicates removed | 4 |
| Rejection + duplicate rate | 0.9% |
| Template records (`source.kind = template`) | 376 |
| Real-execution records (`source.kind = execution`) | 79 |
| Distinct trajectories | 14 |

Previous state was 379 generated / 376 validated / 3 duplicates with no execution records.

## Category distribution

| Category | Records |
| --- | --- |
| requirement_extraction | 74 |
| intent_understanding | 53 |
| task_planning | 53 |
| error_recovery | 50 |
| file_reading | 46 |
| file_editing | 34 |
| project_structure | 30 |
| code_generation | 25 |
| file_creation | 19 |
| dependency_installation | 18 |
| diagnostics | 17 |
| test_execution | 13 |
| completion_verification | 9 |
| task_state_update | 8 |
| task_resumption | 6 |

## Language distribution

| Language | Records |
| --- | --- |
| en | 359 |
| fa | 89 |
| mixed | 7 |

Mixed-language records are new in this phase (previously 0). They interleave Persian instructions with English tool
names, identifiers, error text and command output.

## Tool distribution

| Tool | Calls | Phase 1 | Development target |
| --- | --- | --- | --- |
| read_file | 134 | 130 | — |
| project_structure | 73 | 72 | — |
| list_directory | 59 | 58 | — |
| write_file | 38 | 31 | 60 |
| edit_file | 36 | 26 | 60 |
| run_tests | 23 | 9 | 60 |
| install_dependencies | 18 | 11 | 60 |
| inspect_diagnostics | 16 | 8 | 60 |
| run_shell | 12 | 4 | 60 |
| find_symbols | 8 | 1 | 60 |
| search_code | 8 | 1 | 60 |

The eight previously under-represented tools grew from 91 to 159 calls (1.75x), and the three dominant tools went from
74% to 63% of all calls. The skew is reduced, not fixed: every rare tool is still below its target.

## Coverage against the phase targets

| Area | Count | Target |
| --- | --- | --- |
| intent | 127 | 200 |
| planning | 53 | 200 |
| tool selection | 76 | 300 |
| tool execution | 101 | 300 |
| task state | 14 | 200 |
| coding | 78 | 300 |
| debugging | 50 | 200 |
| verification | 22 | 100 |
| Persian | 89 | 200 |
| mixed language | 7 | 50 |

These are development targets, not quotas. Nothing was padded to hit them; every shortfall above is real.

## Duplicate and rejection statistics

- 4 duplicates removed (1 project_structure, 2 diagnostics, 1 file_creation), all exact fingerprint matches of a
  near-identical record. Each is recorded in `datasets/rejected/rejected-duplicates.jsonl` with its duplicate target.
- 0 validator rejections in the committed corpus. During this phase the validator rejected 32 records for a 2-letter
  language id pattern that excluded `mixed`, and 48 for an empty string in `context.workspace`. Both were fixed at the
  source (schema pattern, workspace construction), not by relaxing the check.

## Split statistics

| Split | Records | Groups |
| --- | --- | --- |
| train | 292 | 115 |
| validation | 48 | 18 |
| test | 58 | 19 |
| held-out | 57 | 19 |
| total | 455 | 171 |

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
| train | 292 | 369,277 |
| validation | 48 | 61,261 |
| test | 58 | 71,987 |
| held-out | 57 | 76,499 |

Preference pairs: 25. Held-out evaluation cases: 57, plus three derived suites (tool calling, coding, multilingual) and
a deterministic 71-case Colab subsample.

Prompt+answer estimate across the whole corpus: 181,825 tokens (average 400, median 356, p95 607, max 1859).

## What is real here

- 79 records carry results produced by `packages/core/src/olive/tools.ts` running against a temporary fixture
  workspace: real file reads, real edits, real `node --test` runs (including failures), real `npm` installs, real
  `node --check` diagnostics, real `not-found`/`no-match`/`command-failed` errors, and real recovery afterwards.
- The remaining 376 are template-generated from project archetypes. They are structurally valid and copied from real
  file contents, but they are not observed agent behaviour.

## Limitations and known quality problems

1. **Coverage is still thin exactly where it matters.** Task state (14), verification (22) and mixed language (7) are
   the areas a tool-calling model needs most, and they are the smallest.
2. **Trajectories are short and scripted.** Six scenarios of 4-8 steps each. They teach the shape of a verified run
   (inspect → change → diagnose → test → report), not the long tail of real debugging.
3. **Assistant text is authored, not sampled.** The actions and results in executed records are real; the one-line
   narration next to them is written by the generator. This is stated in `source.kind = "execution"` and in each
   record's `validation.notes`.
4. **Template phrasing repeats.** Deduplication removes near-identical records, but the same sentence patterns appear
   across projects. A model trained on this may learn the template's voice.
5. **No native-speaker review** of the 89 Persian records.
6. **The dominant tools remain dominant.** `read_file`, `project_structure` and `list_directory` are 40% of calls
   because the agent prompt itself says "inspect before editing"; that is realistic but it biases selection.
7. **Evaluation suites are small** (11-24 cases per suite) and derived from the same held-out groups, so per-suite
   numbers carry wide uncertainty.
