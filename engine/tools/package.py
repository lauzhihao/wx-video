"""Write the publish sheet for a run and record it in runs/ledger.json.

usage: python tools/package.py <run_dir>
out/发布信息.txt: 标题 / 简介 / 标签 / 发布时要选的标注 / 文件清单; ledger status -> produced.
"""
import json
import os
import subprocess
import sys

run = os.path.abspath(sys.argv[1])
root = os.path.dirname(run)
topic = json.load(open(os.path.join(run, 'topic.json'), encoding='utf-8'))
spec = json.load(open(os.path.join(run, 'spec.json'), encoding='utf-8'))
tl = json.load(open(os.path.join(run, 'timeline.json'), encoding='utf-8'))
out = os.path.join(run, 'out')
up = os.path.join(out, 'upload.mp4')
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', up], capture_output=True, text=True).stdout.strip() or 0)
size = os.path.getsize(up) / 1e6
title = ' '.join(topic.get('title') or [])
sheet = f"""视频号发布信息（issue #{topic['_issue']}）

封面标题：{title}
视频描述（直接复制）：
{topic.get('intro', '')}

{' '.join(topic.get('tags') or [])}

发布时的标注：选「含AI生成内容」（画面用了 AI 生成的底图，旁白是 AI 配音）。
原创声明：不要勾选（时事资讯类不在原创声明范围内）。

文件：
  成片  out/upload.mp4   {dur:.1f} 秒，{size:.1f} MB，1080×1920，60fps
  封面  out/cover_1080x1260.png（6:7）/ cover_1080x1440.png（3:4）/ cover_1080x1920.png（9:16）
来源：{topic.get('source', '')}
"""
open(os.path.join(out, '发布信息.txt'), 'w', encoding='utf-8').write(sheet)
led_p = os.path.join(root, 'ledger.json')
led = json.load(open(led_p, encoding='utf-8')) if os.path.exists(led_p) else {}
led[str(topic['_issue'])] = {
    'run': os.path.basename(run), 'date': topic.get('date'), 'angle': topic.get('angle'), 'title': topic.get('title'),
    'status': 'produced', 'theme': spec.get('theme'), 'mood': (spec.get('music') or {}).get('mood'),
    'shots': [s['type'] for s in tl['shots']], 'duration': round(dur, 2), 'upload_mb': round(size, 1),
}
json.dump(led, open(led_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(sheet)
