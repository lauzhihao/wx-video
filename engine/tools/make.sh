#!/bin/bash
# One run end to end, after spec.json + prompts/*.txt (+ media/) are written:
# plates -> narration -> timeline -> score -> QA stills -> dev-server render -> cover -> publish sheet
# usage: tools/make.sh <run_dir>
set -euo pipefail
ENG=$(cd "$(dirname "$0")/.." && pwd); RUN=$(cd "$1" && pwd); ID=$(basename "$RUN")
t0=$(date +%s)
"$ENG/tools/plates.sh" "$RUN"
"$ENG/.venv/bin/python" "$ENG/tools/tts.py" "$RUN"
# listen back: Whisper transcript vs copy (flags minus signs / dropped words; fix with a `say` field)
[ -f "$RUN/voice/voice.json" ] && "$ENG/.venv/bin/python" "$ENG/tools/asr_check.py" "$RUN" || true
node "$ENG/tools/timeline.mjs" "$RUN"
"$ENG/.venv/bin/python" "$ENG/audio/score.py" "$RUN"
# QA sheet: one still per shot (middle of each shot) -> <run>/qa_sheet.jpg
TIMES=$(python3 -c "import json;print(' '.join(f\"{(s['t0']+s['t1'])/2:.2f}\" for s in json.load(open('$RUN/timeline.json'))['shots']))")
( cd "$ENG/web" && ln -sfn ../../runs runs && rm -rf "$RUN/qa" && node still.mjs "$RUN/qa" $TIMES --run=runs/$ID | grep -v '^saved' || true )
ffmpeg -v error -y -pattern_type glob -i "$RUN/qa/t*.png" -vf "scale=270:480,tile=8x2:padding=4:color=gray" -frames:v 1 -update 1 "$RUN/qa_sheet.jpg"
"$ENG/tools/remote_render.sh" "$RUN"
( cd "$ENG/web" && node cover.mjs --run=runs/$ID )
python3 "$ENG/tools/package.py" "$RUN"
echo "MAKE DONE $ID in $(( $(date +%s) - t0 ))s"
