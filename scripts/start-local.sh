#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
slotkit_root="${SLOTKIT_SOURCE_DIR:-$project_root/../slotkit}"
export SLOTKIT_SOURCE_DIR="$slotkit_root"
# make dev may stop unrelated listeners; invoke it only after checking ownership.
if ! tmux has-session -t slotkit-dev 2>/dev/null; then
  for port in 8000 5173 5174 4321; do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf 'Port %s is occupied. Resolve its owner before starting Slotkit.\n' "$port" >&2
      exit 1
    fi
  done
  make -C "$slotkit_root" dev
fi
if ! tmux list-windows -t slotkit-dev -F '#{window_name}' | rg -qx demo; then
  if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'Demo port 3000 is occupied. Resolve its owner first.\n' >&2
    exit 1
  fi
fi
if [ ! -f "$project_root/data/fixture.json" ]; then
  php "$slotkit_root/tests/e2e/support/sdk-fixture.php" prepare "$project_root/data/fixture.json"
  php "$project_root/scripts/configure-local.php"
fi
php "$project_root/scripts/calendar-state.php" active
tmux set-environment -t slotkit-dev SLOTKIT_SOURCE_DIR "$slotkit_root"
tmux respawn-pane -k -t slotkit-dev:api "php '$project_root/scripts/local-artisan.php' serve --host=127.0.0.1 --port=8000"
tmux respawn-pane -k -t slotkit-dev:worker "php '$project_root/scripts/local-worker.php' queue:work rabbitmq --queue=outbox,calendar,email,webhook,billing,notifications --sleep=1 --tries=10 --timeout=60"
if tmux list-windows -t slotkit-dev -F '#{window_name}' | rg -qx demo; then
  tmux respawn-pane -k -t slotkit-dev:demo "cd '$project_root' && npm run dev"
else
  tmux new-window -d -t slotkit-dev -n demo -c "$project_root" 'npm run dev'
fi
printf 'Local demo started at http://127.0.0.1:3000 (synthetic Calendar only).\n'
