#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

compose() {
  docker compose --project-name networkai --env-file "$project_dir/.env" -f "$project_dir/compose.yaml" "$@"
}

case "${1:-up}" in
  up)
    python3 scripts/configure-local.py
    docker info >/dev/null 2>&1 || { echo 'Open Docker Desktop, wait for it to start, then try again.'; exit 1; }
    compose up --build --detach --wait --wait-timeout 300
    python3 -c 'from pathlib import Path; p=dict(line.split("=",1) for line in Path(".env").read_text().splitlines() if "=" in line and not line.startswith("#")); print("NetworkAI is running at http://localhost:"+p.get("WEB_PORT","3000"))'
    ;;
  stop) compose stop ;;
  status) compose ps ;;
  logs) compose logs --tail=80 ;;
  *) echo 'Usage: sh scripts/local.sh [up|stop|status|logs]'; exit 2 ;;
esac
