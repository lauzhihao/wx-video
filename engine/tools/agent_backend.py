#!/usr/bin/env python3
"""Run one shared production prompt through agy, Codex, then Claude Code.

This module adds no production stages or quality policy. A backend is attempted
once. Startup failures, nonzero exits, explicit quota errors and timeouts fall
through to the next backend after the previous process group is stopped.
"""
from __future__ import annotations

import codecs
import json
import os
import re
import shlex
import selectors
import signal
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ORDER = ("agy", "codex", "claude")
# These are provider error messages, rather than general mentions of quotas.
QUOTA_ERROR = re.compile(
    r"insufficient_quota|quota_exceeded|resource_exhausted|rate_limit_exceeded|"
    r"(?:quota|usage limit|rate limit) (?:has been |is )?(?:exceeded|exhausted|reached)|"
    r"(?:exceeded|exhausted|reached) (?:your |the )?(?:quota|usage limit|rate limit)|"
    r"you(?:'ve| have) hit your (?:usage|rate) limit|"
    r"credit balance is too low|not enough (?:credits|quota)|"
    r"(?:额度|配额)(?:已)?(?:耗尽|不足|用尽|超限)|超出(?:使用)?(?:额度|配额)",
    re.I,
)



@dataclass
class BackendResult:
    backend: str
    model: str
    returncode: int
    reason: str
    log_file: Path


def load_backends(path: Path) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("backends"), list):
        raise ValueError("agent_backends.json must have version=1 and a backends list")
    entries = data["backends"]
    if len(entries) != len(ORDER) or any(not isinstance(item, dict) for item in entries):
        raise ValueError("Configure exactly agy, codex and claude backends")
    by_id = {item.get("id"): item for item in entries}
    if set(by_id) != set(ORDER):
        raise ValueError("Configure exactly agy, codex and claude backends")
    result = []
    for name in ORDER:
        item = dict(by_id[name])
        for field in ("command", "model", "effort"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                raise ValueError(f"{name}.{field} must be a nonempty string")
        timeout = item.get("timeout_seconds", 3600)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout < float("inf"):
            raise ValueError(f"{name}.timeout_seconds must be positive and finite")
        item["timeout_seconds"] = float(timeout)
        result.append(item)
    return result


def command_for(backend: dict, prompt: str, root: Path) -> list[str]:
    command = shlex.split(backend["command"])
    if not command:
        raise ValueError("Empty backend command")
    name, model, effort = (backend[key] for key in ("id", "model", "effort"))
    if name == "agy":
        return command + ["--dangerously-skip-permissions", "--model", model, "--effort", effort, "-p", prompt]
    if name == "codex":
        return command + ["exec", "--dangerously-bypass-approvals-and-sandbox", "-m", model, "-c", f'model_reasoning_effort="{effort}"', "--ephemeral", "-C", str(root), prompt]
    if name == "claude":
        return command + ["--dangerously-skip-permissions", "--model", model, "--effort", effort, "-p", prompt]
    raise ValueError(f"Unsupported backend: {name}")


def backend_environment(name: str) -> dict[str, str]:
    """Preserve credentials/config used by shared production tools."""
    env = os.environ.copy()
    # A child CLI starts its own session rather than inheriting a nesting guard.
    env.pop("CLAUDECODE", None)
    defaults = {
        "http_proxy": "http://127.0.0.1:10808",
        "https_proxy": "http://127.0.0.1:10808",
        "HTTP_PROXY": "http://127.0.0.1:10808",
        "HTTPS_PROXY": "http://127.0.0.1:10808",
        "all_proxy": "socks5://127.0.0.1:10808",
        "ALL_PROXY": "socks5://127.0.0.1:10808",
        "no_proxy": "localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.jwd.group,feishu.cn,feishu.net,larksuite.com",
        "NO_PROXY": "localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.jwd.group,feishu.cn,feishu.net,larksuite.com",
    }
    for key, value in defaults.items():
        if not env.get(key):
            env[key] = value
    return env


def stop_process_group(proc: subprocess.Popen) -> None:
    """TERM, wait, then KILL the entire old group before attempting a fallback."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    # The leader may have exited while a tool subprocess is still running.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait()


def _redact(text: str, env: dict[str, str]) -> str:
    for key, value in env.items():
        if len(value) >= 8 and re.search(r"(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", key, re.I):
            text = text.replace(value, "[REDACTED]")
    return text


def quota_failure(output: str) -> bool:
    # Never interpret ordinary narration (e.g. "配额不足时切换") as failure.
    for line in output.splitlines():
        text = line.strip()
        if re.match(r"^(?:error\b|api error\b|resource_exhausted\b|insufficient_quota\b|quota_exceeded\b|rate_limit_exceeded\b)", text, re.I) and (QUOTA_ERROR.search(text) or re.search(r"\b429\b", text)):
            return True
        try:
            event = json.loads(text)
        except ValueError:
            continue
        if isinstance(event, dict) and (event.get("is_error") is True or event.get("type") in ("error", "turn.failed")) and QUOTA_ERROR.search(text):
            return True
    return False


def _stream_process(command: list[str], root: Path, env: dict[str, str], timeout: float, log) -> tuple[int, str, bool]:
    proc = subprocess.Popen(command, cwd=str(root), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    pending, lines, timed_out, exited_at = "", [], False, None
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    started = time.monotonic()

    def emit(text: str) -> None:
        redacted = _redact(text, env)
        lines.append(redacted)
        log.write(redacted)
        log.flush()
        print(redacted, end="", flush=True)

    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if not timed_out and time.monotonic() - started >= timeout and proc.poll() is None:
                    timed_out = True
                    stop_process_group(proc)
                events = selector.select(timeout=0.2)
                for key, _ in events:
                    data = os.read(key.fd, 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    pending += decoder.decode(data)
                    while "\n" in pending:
                        line, pending = pending.split("\n", 1)
                        emit(line + "\n")
                if proc.poll() is not None:
                    exited_at = exited_at or time.monotonic()
                    if selector.get_map() and not events and time.monotonic() - exited_at > 1:
                        # An exited CLI must not leave tools holding this pipe.
                        stop_process_group(proc)
            pending += decoder.decode(b"", final=True)
            if pending:
                emit(pending)
        remaining = timeout - (time.monotonic() - started)
        try:
            code = proc.wait(timeout=max(remaining, 0.01))
        except subprocess.TimeoutExpired:
            timed_out = True
            stop_process_group(proc)
            code = proc.returncode
        if code or quota_failure("".join(lines)):
            stop_process_group(proc)
        return code, "".join(lines), timed_out
    except BaseException:
        stop_process_group(proc)
        raise
    finally:
        proc.stdout.close()


def run_with_fallback(prompt: str, backends: list[dict], root: Path, logs_dir: Path) -> BackendResult:
    logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    last = None
    for backend in backends:
        name, model = backend["id"], backend["model"]
        log_file = logs_dir / f"wx_daily_{stamp}_{name}.log"
        print(f"[INFO] backend={name} model={model}; log={log_file}", flush=True)
        env = backend_environment(name)
        with log_file.open("w", encoding="utf-8") as stream:
            stream.write(f"backend={name}\nmodel={model}\n\n")
            stream.flush()
            try:
                code, output, timed_out = _stream_process(command_for(backend, prompt, root), root, env, backend["timeout_seconds"], stream)
                if timed_out:
                    code, reason = 124, f"CLI timed out after {backend['timeout_seconds']:g}s"
                elif code:
                    reason = f"CLI exited with {code}"
                elif quota_failure(output):
                    code, reason = 75, "CLI reported quota/rate-limit exhaustion"
                else:
                    reason = "CLI completed successfully"
            except OSError as exc:
                code, reason = 127, f"CLI could not start: {exc}"
            stream.write(f"\nreturncode={code}\nreason={reason}\n")
        last = BackendResult(name, model, code if code >= 0 else 128 - code, reason, log_file)
        print(f"[{'INFO' if code == 0 else 'WARN'}] {name}: {reason}", flush=True)
        if code == 0:
            return last
    if last is None:
        raise ValueError("No backends configured")
    return last
