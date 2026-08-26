#!/usr/bin/env bash
#
# Cron wrapper for daily-sync.mjs, for the Oracle n8n box.
#
#   ~/ruislip/run-daily.sh euronics --auto-apply
#   ~/ruislip/run-daily.sh manufacturer-rrp
#
# Extra arguments are passed straight through to daily-sync.mjs. --auto-apply
# belongs in the crontab line rather than in here: the one flag that can change
# a live price should be visible where someone reads the schedule.
#
# WHY A WRAPPER AND NOT AN n8n "EXECUTE COMMAND" NODE
# n8n runs in a container, so it cannot see this script or its Node on the
# host. Host cron runs the collector; n8n is reached over HTTP like any other
# trigger. That also keeps the collector secret out of the n8n database.
#
# CONFIG lives in ~/ruislip/.env (chmod 600, never committed):
#   SITE_URL, PRICE_INGEST_SECRET_COLLECTOR, N8N_WEBHOOK
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$DIR/.env"; set +a

SOURCE="${1:-euronics}"
[ $# -gt 0 ] && shift
mkdir -p "$DIR/logs"
LOG="$DIR/logs/$SOURCE-$(date +%F).log"

node "$DIR/daily-sync.mjs" --source "$SOURCE" "$@" >"$LOG" 2>&1
SUMMARY=$(grep '^SUMMARY_JSON:' "$LOG" | tail -1 | cut -c14-)

# A run that dies before printing its summary is reported as a failure, never
# dropped. A silent morning must not read as "no price changes today".
if [ -z "$SUMMARY" ]; then
  SUMMARY="{\"source\":\"$SOURCE\",\"error\":true,\"note\":$(tail -3 "$LOG" | tr -cd '[:alnum:][:blank:]:.,/()=-' | cut -c1-300 | sed 's/.*/"&"/')}"
fi

curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' -d "$SUMMARY" "$N8N_WEBHOOK" >>"$LOG" 2>&1

find "$DIR/logs" -name '*.log' -mtime +14 -delete
