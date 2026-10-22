#!/bin/bash
# Render one run: push engine + run inputs to a render host, render there, pull the results back.
# usage: tools/remote_render.sh <run_dir> [WORKERS=6] [SS=2] [MB=2]
#
# WX_SSH_HOST    ssh alias of the render machine. Empty = render on this machine.
# WX_REMOTE_DIR  base directory on that machine (default ~/wx-daily).
# The remote host needs node + node_modules installed under <WX_REMOTE_DIR>/engine/web.
set -euo pipefail
HOST=${WX_SSH_HOST:-}
RDIR=${WX_REMOTE_DIR:-wx-daily}
ENG=$(cd "$(dirname "$0")/.." && pwd)
RUN=$(cd "$1" && pwd); ID=$(basename "$RUN"); W=${2:-6}; SS=${3:-2}; MB=${4:-2}

if [ -z "$HOST" ]; then
  ln -sfn ../../runs "$ENG/web/runs"
  bash "$ENG/scripts/render_run.sh" "$ID" "$W" "$SS" "$MB"
  exit 0
fi

ssh -o BatchMode=yes $HOST "mkdir -p ~/$RDIR/engine ~/$RDIR/runs/$ID"
rsync -a --delete --exclude node_modules --exclude runs --exclude '.chrome-profile*' "$ENG/web/" $HOST:$RDIR/engine/web/
rsync -a "$ENG/scripts/" $HOST:$RDIR/engine/scripts/
ssh -o BatchMode=yes $HOST "cd ~/$RDIR/engine/web && ln -sfn ../../runs runs && [ -d node_modules ] || { echo 'REMOTE node_modules missing: run npm install in ~/$RDIR/engine/web'; exit 4; }"
rsync -a --include 'spec.json' --include 'timeline.json' --include 'plates/' --include 'plates/*.png' --exclude 'plates/*_raw.png' \
  --include 'media/***' --include 'audio/' --include 'audio/mix.wav' --exclude '*' "$RUN/" $HOST:$RDIR/runs/$ID/
ssh -o BatchMode=yes $HOST "bash ~/$RDIR/engine/scripts/render_run.sh $ID $W $SS $MB"
mkdir -p "$RUN/out"
rsync -a $HOST:$RDIR/runs/$ID/out/master.mp4 $HOST:$RDIR/runs/$ID/out/upload.mp4 "$RUN/out/"
ls -la "$RUN/out/"
