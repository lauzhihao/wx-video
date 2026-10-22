#!/usr/bin/env python3
"""Autonomous Video Studio Daily WeChat Channels Dispatcher & Runner.

Scans for open topic issues in GitHub lauzhihao/wx-video, checks against
runs/ledger.json, and invokes agy, Codex, then Claude Code as fallbacks to perform end-to-end
production, QA, publishing to WeChat Channels via Ego Lite, and issue closure.

Designed to be invoked unattended via macOS LaunchAgent:
com.lauzhihao.wx-daily
"""

import argparse
import atexit
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from agent_backend import load_backends, run_with_fallback

ENGINE_DIR = Path(__file__).resolve().parent.parent
WX_DAILY_DIR = ENGINE_DIR.parent
LOGS_DIR = WX_DAILY_DIR / "logs"
RUNS_DIR = WX_DAILY_DIR / "runs"
LEDGER_FILE = RUNS_DIR / "ledger.json"
LOCK_FILE = RUNS_DIR / "auto_wx_producer.lock"

BACKEND_CONFIG = ENGINE_DIR / "agent_backends.json"

class ProcessLock:
    def __init__(self, lock_path: Path):
        self.lock_path = lock_path
        self.acquired = False

    def acquire(self, force: bool = False) -> bool:
        if self.lock_path.exists():
            try:
                with open(self.lock_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                pid = data.get("pid")
                if pid and self._is_pid_running(pid):
                    if force:
                        print(f"[WARN] 进程锁被 PID {pid} 持有，但已指定 --force，强行接管锁。")
                    else:
                        print(f"[INFO] 已有实例正在运行 (PID {pid})，本次调度跳过。")
                        return False
                else:
                    print(f"[INFO] 清理已失效的历史进程锁 (PID {pid})。")
            except Exception:
                pass

        payload = {
            "pid": os.getpid(),
            "time": datetime.now().isoformat(),
        }
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        self.acquired = True
        return True

    def release(self):
        if self.acquired and self.lock_path.exists():
            try:
                with open(self.lock_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("pid") == os.getpid():
                    self.lock_path.unlink(missing_ok=True)
            except Exception:
                self.lock_path.unlink(missing_ok=True)
            self.acquired = False

    @staticmethod
    def _is_pid_running(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def fetch_pending_topics(read_only: bool = False) -> list:
    if read_only:
        # fetch_topics.py writes topic.json; previews use the same GitHub query
        # directly so check-only/dry-run do not create inputs or acquire a lock.
        r = subprocess.run(
            ["gh", "issue", "list", "--repo", "lauzhihao/wx-video", "--label", "topic", "--state", "open", "--limit", "50", "--json", "number,title,body,createdAt"],
            cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=90,
        )
        if r.returncode:
            raise RuntimeError(f"GitHub topic fetch failed (exit {r.returncode}): {r.stderr.strip()}")
        import re
        ledger = json.loads(LEDGER_FILE.read_text(encoding="utf-8")) if LEDGER_FILE.exists() else {}
        rows = []
        for issue in json.loads(r.stdout):
            if ledger.get(str(issue["number"]), {}).get("status") in ("published", "skipped"):
                continue
            match = re.search(r"```json\s*(.*?)\s*```", issue.get("body") or "", re.S)
            if not match:
                print(f"[WARN] Issue #{issue['number']}: no JSON block", file=sys.stderr)
                continue
            topic = json.loads(match.group(1))
            date = (topic.get("date") or issue["createdAt"][:10]).replace("-", "")
            title = topic.get("title") or []
            body = topic.get("body") or []
            if not isinstance(title, list) or len(title) != 2 or any(not isinstance(line, str) or sum(2 if ord(c) > 127 else 1 for c in line) > 20 for line in title) or not isinstance(body, list) or len(body) != 3:
                print(f"[WARN] Issue #{issue['number']}: invalid topic fields", file=sys.stderr)
                continue
            rows.append({"issue": issue["number"], "run": f"runs/{date}-{issue['number']}", "title": title})
        return rows
    fetch_script = ENGINE_DIR / "tools" / "fetch_topics.py"
    r = subprocess.run([sys.executable, str(fetch_script)], cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=90)
    if r.returncode:
        raise RuntimeError(f"fetch_topics.py failed (exit {r.returncode}): {r.stderr.strip()}")
    data = json.loads(r.stdout.strip())
    if not isinstance(data, list):
        raise RuntimeError("fetch_topics.py did not return a topic list")
    return [item for item in data if not item.get("problems") and not item.get("error")]


def construct_prompt(todo: list) -> str:
    issues_str = ", ".join(f"#{t['issue']}（{t.get('title', [''])[0]}）" for t in todo)
    return f"""请作为视频号自动生产 Operator，严格按照项目根目录 `RUNBOOK.md` 的规定，完成今日待办选题的自动化制作与发布：

待办选题清单：{issues_str}

核心规则与用户强制要求：
1. 【严格禁令】绝对不要把“大佬”、“钱”、“反差”这三种类型词写到封面、钩子底图（hook plate）或视频画面里的任何文字上！在 spec.json 中将 "tag" 设为 ""。
2. 串行完成每条选题：
   - 编写 research.md 提取具体数据点；
   - 生成 9:16 底图（hero 与 benchmark）并放大；
   - 合成旁白 TTS，运行 asr_check.py 确保听写全部通过；
   - 生成 timeline.json 与 audio/mix.wav；
   - 提取静帧生成 qa_sheet.jpg 进行构图与安全区（y 250-1450）核查；
   - 执行渲染与 3:4 封面生成；
   - 通过 Ego Lite (WX_VIDEOS profile) 执行 `tools/wx_post.sh <run_dir> --publish` 发布到视频号；
   - 验证发布列表截图后，运行 `tools/close_topic.sh` 关闭 GitHub issue 并同步更新 ledger.json；
   - 清理本地 .mp4 和 .wav 临时媒体文件。
3. 发布设置规范：不显示位置、勾选“含AI生成内容”、不声明原创。
   BGM 统一用 engine/music_config.json 指定的音轨，由 audio/score.py 自动混音；保留旁白。
   音量沿用 music-forward-12db 预设：在原有混音基础上将 BGM 提高 12 dB。
4. 这是可续做的同一批任务：执行前读取 runs/ledger.json 和各 run 的已有产物，优先复用已完成步骤。
   已标记 published/skipped 的选题跳过；若已有发布结果，核对平台列表并补关单，不重复发表。
   不因后端切换重新生成完整项目，按现有文件、日志和台账继续剩余工作。
"""


def run(check_only: bool = False, dry_run: bool = False, force: bool = False, backend_config: Path = BACKEND_CONFIG) -> int:
    now = datetime.now()
    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 启动视频号每日自动生产守护进程...")
    lock = ProcessLock(LOCK_FILE)
    preview = check_only or dry_run
    if not preview and not lock.acquire(force=force):
        return 0
    if not preview:
        atexit.register(lock.release)
    try:
        todo = fetch_pending_topics(read_only=preview)
        if not todo:
            print("[INFO] 当前没有需要制作的视频号选题，执行结束。")
            return 0
        print(f"[INFO] 发现待制作选题共 {len(todo)} 条：")
        for t in todo:
            print(f"  - Issue #{t['issue']}: {'｜'.join(t.get('title') or [])} ({t.get('run')})")
        if check_only:
            print("[INFO] --check-only 模式，退出。")
            return 0
        backends = load_backends(backend_config)
        prompt = construct_prompt(todo)
        if dry_run:
            print("[DRY-RUN] 后端顺序：" + " → ".join(f"{b['id']}+{b['model']}" for b in backends))
            print("\n[DRY-RUN] 三个后端共用的 Prompt：\n" + prompt)
            return 0
        result = run_with_fallback(prompt, backends, WX_DAILY_DIR, LOGS_DIR)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 流水线结束 backend={result.backend} model={result.model} (退出码: {result.returncode})。")
        return result.returncode
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    finally:
        if not preview:
            lock.release()


def main() -> int:
    parser = argparse.ArgumentParser(description="WeChat Daily Production: agy → Codex → Claude Code fallback")
    parser.add_argument("--check-only", action="store_true", help="Check pending topics without writes or model calls")
    parser.add_argument("--dry-run", action="store_true", help="Preview shared prompt and backends without writes or model calls")
    parser.add_argument("--force", action="store_true", help="Force acquire process lock (existing behavior)")
    parser.add_argument("--backend-config", type=Path, default=BACKEND_CONFIG, help="Path to agent_backends.json")
    args = parser.parse_args()
    return run(check_only=args.check_only, dry_run=args.dry_run, force=args.force, backend_config=args.backend_config)


if __name__ == "__main__":
    raise SystemExit(main())
