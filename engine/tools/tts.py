"""Narration via an IndexTTS2 HTTP service (default http://127.0.0.1:7861/v1/audio/speech).

usage: python tools/tts.py <run_dir>
Writes <run_dir>/voice/segNN.wav (48 kHz mono, trimmed) and voice/voice.json with per-segment durations.
If index-tts.service is stopped it is started for this run and stopped again afterwards (restores the prior state).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

import numpy as np
import soundfile as sf
from scipy import signal

URL = os.environ.get('WX_TTS_URL', 'http://127.0.0.1:7861')
# SSH alias of the machine running index-tts.service; empty = service is managed elsewhere
SSH_HOST = os.environ.get('WX_SSH_HOST', '')
SSH = ['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', SSH_HOST] if SSH_HOST else []
SR = 48000
# the service sits on a tailscale address: never route it through the local HTTP(S)_PROXY
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def speakable(text):
    """Pronunciation pass for the TTS input only (subtitles keep the original copy).
    IndexTTS's text normaliser reads a hyphen before a digit as a minus sign ("GPT-6.1" -> "GPT 负六点一")."""
    t = text
    t = re.sub(r'(?<=\d)\s*[-–—~～]\s*(?=\d)', '到', t)                   # 2025-2026, 1-2 天 -> 到
    t = re.sub(r'(?<=[A-Za-z])[-–—_](?=[A-Za-z0-9])', ' ', t)                   # GPT-6.1, Claude-3, Qwen-Max
    t = re.sub(r'(?<=[0-9])[-–—_](?=[A-Za-z])', ' ', t)                         # 2.5-Max
    t = re.sub(r'(?<=[一-鿿])\s*[-–—]+\s*(?=[一-鿿])', '，', t) # 中文-中文 dash -> pause
    return re.sub(r'\s+', ' ', t).strip()


def service_active():
    if not SSH:
        return True  # no host configured: assume the service is already running
    r = subprocess.run(SSH + ['systemctl is-active index-tts.service'], capture_output=True, text=True)
    return r.stdout.strip() == 'active'


def wait_health(timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with OPENER.open(URL + '/health', timeout=5) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


def synth(text, voice):
    body = json.dumps({'model': 'indextts2', 'input': text, 'voice': voice}).encode()
    req = urllib.request.Request(URL + '/v1/audio/speech', data=body, headers={'Content-Type': 'application/json'})
    with OPENER.open(req, timeout=600) as r:
        return r.read()


def trim_and_resample(path_in, path_out):
    x, sr = sf.read(path_in, always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        x = signal.resample_poly(x, SR, sr)
    env = np.abs(x)
    thr = 10 ** (-45 / 20) * max(env.max(), 1e-9)
    idx = np.where(env > thr)[0]
    a, b = (idx[0], idx[-1]) if len(idx) else (0, len(x) - 1)
    a = max(0, a - int(0.02 * SR)); b = min(len(x), b + int(0.08 * SR))
    y = x[a:b]
    y = y / (np.abs(y).max() + 1e-9) * 0.9
    sf.write(path_out, y.astype(np.float32), SR, subtype='PCM_24')
    return len(y) / SR


def main():
    run = sys.argv[1]
    spec = json.load(open(os.path.join(run, 'spec.json'), encoding='utf-8'))
    vcfg = spec.get('voice') or {}
    if not vcfg.get('enabled'):
        print('voice disabled in spec; nothing to do')
        return
    voice = vcfg.get('voice', 'matrix_female')
    out = os.path.join(run, 'voice')
    os.makedirs(out, exist_ok=True)
    # what is actually spoken: an explicit `say` override, else the copy after the pronunciation pass
    want = {i: speakable((sg.get('say') or sg.get('vo') or '').strip()) for i, sg in enumerate(spec['segments']) if (sg.get('vo') or '').strip()}
    vj = os.path.join(out, 'voice.json')
    if os.path.exists(vj):
        old = json.load(open(vj, encoding='utf-8'))
        have = {s['i']: s.get('text') for s in old.get('segments', []) if os.path.exists(os.path.join(run, s['file']))}
        if old.get('voice') == voice and have == want:
            print('narration cached (texts unchanged)')
            return
    started = False
    if SSH and not service_active():
        print('starting index-tts.service (will stop it again afterwards)', flush=True)
        subprocess.run(SSH + ['sudo systemctl start index-tts.service'], check=True)
        started = True
    try:
        if not wait_health():
            raise SystemExit('TTS service did not become healthy')
        segs = []
        for i, sg in enumerate(spec['segments']):
            if i not in want:
                continue
            text = want[i]
            raw = os.path.join(out, f'seg{i:02d}_raw.wav')
            t0 = time.time()
            data = synth(text, voice)
            open(raw, 'wb').write(data)
            dur = trim_and_resample(raw, os.path.join(out, f'seg{i:02d}.wav'))
            os.remove(raw)
            segs.append({'i': i, 'file': f'voice/seg{i:02d}.wav', 'dur': round(dur, 3), 'chars': len(text), 'text': text})
            print(f'seg {i}: {dur:.2f}s for {len(text)} chars ({time.time() - t0:.1f}s)', flush=True)
        json.dump({'voice': voice, 'segments': segs}, open(os.path.join(out, 'voice.json'), 'w'), ensure_ascii=False, indent=1)
    finally:
        if started:
            subprocess.run(SSH + ['sudo systemctl stop index-tts.service'])
            print('index-tts.service stopped again', flush=True)


if __name__ == '__main__':
    main()
