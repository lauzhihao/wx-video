#!/bin/bash
# Generate every plate prompt in <run>/prompts/<name>.txt, then upscale to 1882x3344.
# usage: tools/plates.sh <run_dir>          (existing plates/<name>.png are kept)
#
# WX_IMAGE_CMD  text-to-image command. Receives --prompt-file <txt> --out <png> --size 9:16.
#               Default: `python3 reference/gen-frame.py` (the dispatcher used in video-studio).
# WX_ESRGAN_DIR optional: directory holding realesrgan-ncnn-vulkan + models/.
#               Unset = skip upscaling and resize the raw image directly.
set -uo pipefail
RUN=$(cd "$1" && pwd)
IMG_CMD=${WX_IMAGE_CMD:-python3 reference/gen-frame.py}
R=${WX_ESRGAN_DIR:-}
mkdir -p "$RUN/plates"
n=0
for p in "$RUN"/prompts/*.txt; do
  name=$(basename "$p" .txt)
  [ -f "$RUN/plates/$name.png" ] && continue
  ( $IMG_CMD --prompt-file "$p" --out "$RUN/plates/${name}_raw.png" --size 9:16 > "$RUN/prompts/$name.log" 2>&1 ) &
  n=$((n+1)); (( n % 4 == 0 )) && wait
done
wait
fail=0
for p in "$RUN"/prompts/*.txt; do
  name=$(basename "$p" .txt)
  [ -f "$RUN/plates/$name.png" ] && continue
  raw=$RUN/plates/${name}_raw.png
  if [ ! -f "$raw" ]; then echo "PLATE FAILED: $name (see prompts/$name.log)"; fail=1; continue; fi
  if [ -n "$R" ] && [ -x "$R/realesrgan-ncnn-vulkan" ]; then
    "$R/realesrgan-ncnn-vulkan" -i "$raw" -o "$RUN/plates/${name}_x4.png" -n realesrgan-x4plus -s 4 -m "$R/models" >/dev/null 2>&1 \
      && ffmpeg -v error -y -i "$RUN/plates/${name}_x4.png" -vf scale=1882:3344:flags=area "$RUN/plates/$name.png" && rm -f "$RUN/plates/${name}_x4.png" \
      && echo "plate ok: $name" || { echo "ESRGAN FAILED: $name"; fail=1; }
  else
    # no upscaler: the renderer only needs a plate tall enough for the 1080x1920 frame
    ffmpeg -v error -y -i "$raw" -vf scale=1882:3344:flags=lanczos "$RUN/plates/$name.png" \
      && echo "plate ok (no upscale): $name" || { echo "SCALE FAILED: $name"; fail=1; }
  fi
done
exit $fail
