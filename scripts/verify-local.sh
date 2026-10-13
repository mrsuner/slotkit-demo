#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
slotkit_root="${SLOTKIT_SOURCE_DIR:-$project_root/../slotkit}"
export SLOTKIT_SOURCE_DIR="$slotkit_root"
fixture="$project_root/data/foreign-fixture.json"
if [ -f "$fixture" ]; then
  printf 'A previous verification fixture exists. Recover it before retrying.\n' >&2
  exit 1
fi
cleanup() {
  php "$slotkit_root/tests/e2e/support/sdk-fixture.php" cleanup "$fixture"
}
trap cleanup EXIT
php "$slotkit_root/tests/e2e/support/sdk-fixture.php" prepare "$fixture"
cd "$project_root"
node --env-file=.env scripts/live-check.mjs
