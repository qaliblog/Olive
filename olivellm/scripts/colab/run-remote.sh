#!/usr/bin/env bash
# Uploads the inputs a Colab script needs, then runs it, over a single connection.
#
# Colab releases the runtime when the client disconnects, so a later `colab exec` starts against an empty /content and
# fails with FileNotFoundError. Uploading first costs a few seconds and removes that whole class of retry.
#
#   bash olivellm/scripts/colab/run-remote.sh /content/train_lora.py --timeout 5400 --env OLIVE_SEQUENCE=3072
#
# Environment: OLIVE_COLAB_SESSION, OLIVE_COLAB_GPU.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package="$(cd "$here/../.." && pwd)"
session="${OLIVE_COLAB_SESSION:-olive-lfm-gpu}"
cli="${HOME}/.local/bin/colab"
[[ -x "$cli" ]] || cli="$(command -v colab)"

remote() { bash "$here/colab-env.sh" "$@"; }

if ! "$cli" exec -s "$session" --timeout 60 -f <(echo 'print("ready")') >/dev/null 2>&1; then
  remote new -s "$session" --gpu "${OLIVE_COLAB_GPU:-T4}"
fi

upload() {
  if ! "$cli" upload -s "$session" "$1" "$2" >/dev/null 2>&1; then
    echo "run-remote: upload failed: $1 -> $2" >&2
    exit 1
  fi
}

upload "$here/train_lora.py" /content/train_lora.py
upload "$here/test_masking.py" /content/test_masking.py
upload "$here/evaluate.py" /content/evaluate.py
upload "$here/generate.py" /content/generate.py
upload "$package/datasets/processed/sft-train.jsonl" /content/sft-train.jsonl
upload "$package/datasets/processed/sft-validation.jsonl" /content/sft-validation.jsonl
upload "$package/evaluation/colab/eval-ids.json" /content/eval-ids.json
upload "$package/evaluation/colab/cases-2026-11-07-heldout-v2.json" /content/cases.json

if [[ "${OLIVE_UPLOAD_ONLY:-0}" == "1" ]]; then
  echo "run-remote: uploaded, not running $*"
  exit 0
fi

remote exec -s "$session" "$@"
