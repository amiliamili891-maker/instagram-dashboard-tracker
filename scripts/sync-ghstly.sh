#!/bin/bash
# Ghstly → Supabase sync script
# Runs as cron job every 10 minutes
# Calls the dashboard's /api/sync endpoint with CRON_SECRET auth

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/logs/sync.log"

# Ensure log directory exists
mkdir -p "$PROJECT_DIR/logs"

# Load env
set -a
source "$PROJECT_DIR/.env.local" 2>/dev/null
set +a

# Get the deployed URL (Vercel) or local dev URL
SYNC_URL="${SYNC_BASE_URL:-https://ghstly-dashboard.vercel.app}/api/sync"
CRON_SECRET="${CRON_SECRET}"

if [ -z "$CRON_SECRET" ]; then
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") ERROR: CRON_SECRET not set" >> "$LOG_FILE"
  exit 1
fi

# Call the sync endpoint
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$SYNC_URL" \
  -H "Authorization: Bearer $CRON_SECRET" \
  --max-time 120 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "207" ]; then
  echo "$TIMESTAMP OK ($HTTP_CODE): $BODY" >> "$LOG_FILE"
else
  echo "$TIMESTAMP FAIL ($HTTP_CODE): $BODY" >> "$LOG_FILE"
fi

# Keep log file under 10MB
if [ -f "$LOG_FILE" ] && [ $(wc -c < "$LOG_FILE") -gt 10485760 ]; then
  tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
