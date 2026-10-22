#!/bin/bash
# After the Operator has published a clip: comment on the issue, close it, mark the ledger.
# usage: tools/close_topic.sh <issue> "<视频号链接或发布状态说明>"
set -euo pipefail
N=$1; MSG=$2; ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REPO=${WX_TOPIC_REPO:-lauzhihao/wx-video}
gh issue comment "$N" --repo "$REPO" --body "done，视频号链接：$MSG"
gh issue close "$N" --repo "$REPO"
python3 - "$ROOT/runs/ledger.json" "$N" "$MSG" <<'PY'
import json, sys
p, n, msg = sys.argv[1:]
d = json.load(open(p, encoding='utf-8'))
d.setdefault(n, {})['status'] = 'published'; d[n]['published_note'] = msg
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
PY
echo "issue #$N commented and closed"
