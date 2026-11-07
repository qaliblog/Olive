#!/usr/bin/env bash
# Runs the controlled experiment on one Colab GPU session and brings the artifacts back.
#
# One connection carries the whole experiment: every stage runs inside the kernel started by a single `colab exec`, so
# the runtime cannot release /content between stages, and the baseline and the adapter scan reuse the same warm process.
# Uploads are retried because a transient failure here aborted an otherwise healthy run.
#
#   bash olivellm/scripts/colab/run-experiment.sh
#
# Environment: OLIVE_COLAB_SESSION, OLIVE_COLAB_GPU, OLIVE_SEQUENCE, OLIVE_ADAPTER_LOCAL, OLIVE_LOG_DIR,
# OLIVE_RESULTS_LOCAL.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package="$(cd "$here/../.." && pwd)"
session="${OLIVE_COLAB_SESSION:-olive-lfm-gpu}"
cli="${HOME}/.local/bin/colab"
[[ -x "$cli" ]] || cli="$(command -v colab)"
logs="${OLIVE_LOG_DIR:-/tmp}"
sequence="${OLIVE_SEQUENCE:-3072}"
adapter_local="${OLIVE_ADAPTER_LOCAL:-$package/reports/lfm2.5-350m/2026-11-07-lora}"
results_local="${OLIVE_RESULTS_LOCAL:-$package/reports/lfm2.5-350m/2026-11-07-lora/colab-results}"

remote() { bash "$here/colab-env.sh" "$@"; }
marker() { printf '%s\n' "$*"; }

ensure_session() {
  if ! "$cli" exec -s "$session" --timeout 60 -f <(echo 'print("ready")') > /dev/null 2>&1; then
    remote new -s "$session" --gpu "${OLIVE_COLAB_GPU:-T4}" || return 1
  fi
}

upload() {
  for attempt in 1 2 3 4; do
    # An upload onto a path that already exists in the runtime fails, so the remote file is removed first; without this
    # a rerun against a live session aborted here with no useful signal.
    "$cli" rm -s "$session" "$2" > /dev/null 2>&1 || true
    if "$cli" upload -s "$session" "$1" "$2" > /dev/null 2>&1; then return 0; fi
    sleep 5
  done
  echo "run-experiment: upload failed after 4 attempts: $1" >&2
  return 1
}

download() {
  for attempt in 1 2 3; do
    if "$cli" download -s "$session" "$1" "$2" > /dev/null 2>&1; then return 0; fi
    sleep 3
  done
  echo "run-experiment: download failed: $1" >&2
  return 1
}

ensure_session || exit 1

marker "== upload =="
upload "$here/train_lora.py" /content/train_lora.py || exit 1
upload "$here/test_masking.py" /content/test_masking.py || exit 1
upload "$here/evaluate.py" /content/evaluate.py || exit 1
upload "$here/run_all.py" /content/run_all.py || exit 1
upload "$here/generate.py" /content/generate.py || exit 1
upload "$package/datasets/processed/sft-train.jsonl" /content/sft-train.jsonl || exit 1
upload "$package/datasets/processed/sft-validation.jsonl" /content/sft-validation.jsonl || exit 1
upload "$package/evaluation/colab/eval-ids.json" /content/eval-ids.json || exit 1
upload "$package/evaluation/colab/cases-2026-11-07-heldout-v2.json" /content/cases.json || exit 1

marker "== run =="
remote exec -s "$session" --timeout 7200 -f /content/run_all.py \
  --env OLIVE_SEQUENCE="$sequence" \
  --env OLIVE_DATA=/content/sft-train.jsonl \
  --env OLIVE_VAL=/content/sft-validation.jsonl \
  --env OLIVE_EVAL_IDS=/content/eval-ids.json \
  --env OLIVE_CASES=/content/cases.json \
  --env OLIVE_ADAPTER=/content/olive-lora-adapter \
  --env OLIVE_OUT=/content/olive-lora-train.json \
  --env "OLIVE_GIT_COMMIT=f297cf54d3 (uncommitted experiment changes)" > "$logs/experiment-run.txt" 2>&1
marker "exec exit: $?"

marker "== download =="
mkdir -p "$adapter_local" "$results_local"
for file in adapter_config.json adapter_model.safetensors training-config.json train-state.json tokenizer.json tokenizer_config.json special_tokens_map.json chat_template.jinja olive-lora-train.json; do
  download "/content/olive-lora-adapter/$file" "$adapter_local/$file" || marker "missing: $file"
done
for file in summary.json mask.json baseline.json train.json adapter.json olive-lora-train.json; do
  download "/content/results/$file" "$results_local/$file" || marker "missing: $file"
done
download /content/olive-lora-train.json "$results_local/olive-lora-train.json" || marker "missing: training report"

ls -la "$adapter_local" "$results_local" | tail -20
marker "== done =="
