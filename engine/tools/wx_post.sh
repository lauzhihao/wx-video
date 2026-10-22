#!/bin/bash
# Post one finished run to 视频号 via Ego Lite (profile WX_VIDEOS, logged in to 视频号助手).
# usage: tools/wx_post.sh <run_dir> [--publish] [--at HH:MM [--date YYYY-MM-DD]]     without --publish it fills the form and hands the window over;
#        --at schedules the post for HH:MM (视频号「定时」, must be later than now); --date picks a day in the current month (panel allows ~30 days ahead)
set -euo pipefail
ENG=$(cd "$(dirname "$0")/.." && pwd); RUN=$(cd "$1" && pwd); PUB=0
AT=""; DATE=""
shift; while [ $# -gt 0 ]; do case "$1" in --publish) PUB=1;; --at) AT=$2; shift;; --date) DATE=$2; shift;; esac; shift; done
sed -e "s|__RUN__|$RUN|" -e "s|__PUBLISH__|$PUB|" -e "s|__AT__|$AT|" -e "s|__DATE__|$DATE|" "$ENG/tools/wx_post.mjs" | ego-browser nodejs
