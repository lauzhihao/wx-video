#!/bin/bash
# Server side: render runs/<id> in parallel chunks, mux the mix, make the upload encode.
# usage: scripts/render_run.sh <id> [WORKERS=6] [SS=2] [MB=2]
set -euo pipefail
cd "$(dirname "$0")/../web"
ID=$1; W=${2:-6}; SS=${3:-2}; MB=${4:-2}
RUN=runs/$ID; OUT=$(cd .. && pwd)/../runs/$ID/out; mkdir -p "$OUT"
FRAMES=$(python3 -c "import json;print(round(json.load(open('$RUN/timeline.json'))['duration']*60))")
PER=$(( ( (FRAMES + W - 1) / W + 119 ) / 120 * 120 ))
TMP=$OUT/chunks; rm -rf "$TMP"; mkdir -p "$TMP"; : > "$TMP/list.txt"
t0=$(date +%s); pids=()
for ((i=0; i<W; i++)); do
  A=$((i*PER)); B=$(( (i+1)*PER )); (( B > FRAMES )) && B=$FRAMES; (( A >= FRAMES )) && break
  node render.mjs --run=$RUN --from=$A --to=$B --out="$TMP/c$i.mp4" --ss=$SS --mb=$MB --crf=15 --preset=medium > "$TMP/c$i.log" 2>&1 &
  pids+=($!); echo "file 'c$i.mp4'" >> "$TMP/list.txt"
done
fail=0; for p in "${pids[@]}"; do wait $p || fail=1; done
if (( fail )); then echo "RENDER FAILED"; tail -n 5 "$TMP"/c*.log; exit 1; fi
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT/silent.mp4"
t1=$(date +%s)
MIX=$(cd .. && pwd)/../runs/$ID/audio/mix.wav
DUR=$(python3 -c "print($FRAMES/60)")
ffmpeg -v error -y -i "$OUT/silent.mp4" -i "$MIX" -map 0:v -map 1:a -c:v copy -af apad -c:a aac -b:a 320k -ar 48000 -movflags +faststart -t "$DUR" "$OUT/master.mp4"
# upload encode: 2-pass ~5.5 Mbps (a 40 s clip lands under ~30 MB), H.264 High, AAC 192k
ffmpeg -v error -y -i "$OUT/master.mp4" -c:v libx264 -preset slow -b:v 5500k -pass 1 -passlogfile "$TMP/x264" -an -f null /dev/null
ffmpeg -v error -y -i "$OUT/master.mp4" -c:v libx264 -preset slow -b:v 5500k -maxrate 9000k -bufsize 12000k -pass 2 -passlogfile "$TMP/x264" \
  -profile:v high -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -movflags +faststart "$OUT/upload.mp4"
rm -rf "$TMP"
echo "DONE $ID frames=$FRAMES render=$((t1-t0))s total=$(( $(date +%s)-t0 ))s"
