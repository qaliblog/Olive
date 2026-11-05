#!/usr/bin/env bash
# Runs the Colab CLI with HF_TOKEN injected from the repository .env into exec/run kernels.
#
# The token is read from the environment and passed with the CLI's supported `--env` option, so it never appears in a
# committed file, a notebook, or an output log. Local environment variables are not inherited by the remote kernel.
#
#   olivellm/scripts/colab/colab-env.sh new -s olivellm --gpu T4
#   olivellm/scripts/colab/colab-env.sh exec -s olivellm -f script.py --timeout 900
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ ! -f "$root/.env" ]]; then
  echo "missing $root/.env with HF_TOKEN" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$root/.env"
set +a

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is empty in $root/.env" >&2
  exit 1
fi

command="${1:-}"
if [[ "$command" != "exec" && "$command" != "run" ]]; then
  exec colab "$@"
fi
shift
exec colab "$command" "$@" --env "HF_TOKEN=${HF_TOKEN}"
