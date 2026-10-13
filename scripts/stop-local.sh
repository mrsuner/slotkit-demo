#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
slotkit_root="${SLOTKIT_SOURCE_DIR:-$project_root/../slotkit}"
export SLOTKIT_SOURCE_DIR="$slotkit_root"
# Fail closed for synthetic credentials before restoring the ordinary worker.
if [ -f "$project_root/data/fixture.json" ]; then
  php "$project_root/scripts/calendar-state.php" paused
fi
if tmux has-session -t slotkit-dev 2>/dev/null; then
  if tmux list-windows -t slotkit-dev -F '#{window_name}' | rg -qx demo; then
    tmux kill-window -t slotkit-dev:demo
  fi
  tmux respawn-pane -k -t slotkit-dev:api "cd '$slotkit_root/apps/api' && php artisan serve --host=127.0.0.1 --port=8000"
  tmux respawn-pane -k -t slotkit-dev:worker "cd '$slotkit_root/apps/api' && php artisan queue:work rabbitmq --queue=outbox,calendar,email,webhook,billing,notifications --sleep=1 --tries=10 --timeout=60"
fi
printf 'Demo stopped; ordinary Slotkit API and worker restored.\n'
