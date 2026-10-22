"""Pull open `topic` issues from lauzhihao/wx-video into runs/<YYYYMMDD>-<issue>/topic.json.

usage: python tools/fetch_topics.py            -> prints a JSON list of runs that still need producing
Skips issues already recorded in runs/ledger.json (status published / skipped).
The machine-readable json block in the issue body is used verbatim (never edited).
"""
import json
import os
import re
import subprocess
import sys

REPO = os.environ.get('WX_TOPIC_REPO', 'lauzhihao/wx-video')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RUNS = os.path.join(ROOT, 'runs')
LEDGER = os.path.join(RUNS, 'ledger.json')


def gh(*args):
    r = subprocess.run(['gh', *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'gh {" ".join(args)} failed: {r.stderr.strip()}')
    return r.stdout


def main():
    os.makedirs(RUNS, exist_ok=True)
    ledger = json.load(open(LEDGER, encoding='utf-8')) if os.path.exists(LEDGER) else {}
    issues = json.loads(gh('issue', 'list', '--repo', REPO, '--label', 'topic', '--state', 'open', '--limit', '50', '--json', 'number,title,body,createdAt'))
    todo = []
    for it in sorted(issues, key=lambda x: x['number']):
        n = str(it['number'])
        if ledger.get(n, {}).get('status') in ('published', 'skipped'):
            continue
        m = re.search(r'```json\s*(\{.*?\})\s*```', it['body'] or '', re.S)
        if not m:
            todo.append({'issue': it['number'], 'error': 'no machine-readable json block', 'title': it['title']})
            continue
        topic = json.loads(m.group(1))
        date = (topic.get('date') or it['createdAt'][:10]).replace('-', '')
        run = os.path.join(RUNS, f'{date}-{n}')
        os.makedirs(run, exist_ok=True)
        topic['_issue'] = it['number']; topic['_issue_title'] = it['title']
        json.dump(topic, open(os.path.join(run, 'topic.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        problems = []
        if len(topic.get('title') or []) != 2 or any(sum(2 if ord(c) > 127 else 1 for c in t) > 20 for t in topic.get('title') or []):
            problems.append('title must be 2 lines of <= 10 chars')
        if len(topic.get('body') or []) != 3:
            problems.append('body must have 3 lines')
        todo.append({'issue': it['number'], 'run': os.path.relpath(run, ROOT), 'angle': topic.get('angle'), 'title': topic.get('title'), 'problems': problems})
    print(json.dumps(todo, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
