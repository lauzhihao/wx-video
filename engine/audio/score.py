"""Daily clip score: music + narration + light sound design, locked to <run>/timeline.json.

The shared music_config.json selects the default BGM for future wx-daily clips.
Narration (voice/segNN.wav) is preserved, with music ducked underneath it.
Master: -14 LUFS integrated, true peak <= -1 dBTP.

usage: .venv/bin/python audio/score.py <run_dir>   ->   <run_dir>/audio/mix.wav
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy import signal
from scipy.ndimage import maximum_filter1d, uniform_filter1d

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (SR, midi_hz, secs, db, adsr, perc, lp, hp, bp, pan, make_ir, convolve_st, pingpong, softclip,
                   supersaw_pad, felt_piano, bell, pluck, bass_note, kick, snare, clap, hat, impact, riser, whoosh,
                   rev_swell, blip, sine, shelf)

RUN = sys.argv[1]
TL = json.load(open(os.path.join(RUN, 'timeline.json'), encoding='utf-8'))
SPEC = json.load(open(os.path.join(RUN, 'spec.json'), encoding='utf-8'))
DUR = float(TL['duration'])
N = int((DUR + 0.5) * SR)
M = SPEC.get('music') or {}
ENGINE = Path(__file__).resolve().parents[1]
MUSIC = json.loads((ENGINE / 'music_config.json').read_text(encoding='utf-8'))
MOOD = M.get('mood', 'bright')
SEED = int(M.get('seed', SPEC.get('seed', 7)))
RNG = np.random.default_rng(SEED)
BPM = float(M.get('bpm', {'bright': 118, 'calm': 96, 'drive': 124, 'epic': 104, 'twist': 112}.get(MOOD, 116)))
BEAT = 60.0 / BPM
KEYS = {'C': 48, 'C#': 49, 'D': 50, 'Eb': 51, 'E': 52, 'F': 53, 'F#': 54, 'G': 55, 'Ab': 56, 'A': 57, 'Bb': 58, 'B': 59}
ROOT = KEYS.get(M.get('key', ['C', 'D', 'E', 'F', 'G', 'A'][SEED % 6]), 50)
MAJOR = MOOD in ('bright', 'calm') or (MOOD == 'epic' and SEED % 2 == 0)
DING_SRC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'assets', 'sfx', 'cc0', 'ding_kongkuang.mp3'))

STEMS = {k: np.zeros((N, 2)) for k in ('pad', 'bass', 'arp', 'keys', 'perc', 'sfx', 'voice')}
SENDS = {'hall': np.zeros((N, 2)), 'delay': np.zeros((N, 2))}


def put(stem, x, t, gain_db=0.0, p=0.0, hall=0.0, delay=0.0):
    if x.ndim == 1:
        x = pan(x, p) / np.sqrt(2)
    i = int(round(t * SR))
    if i >= N:
        return
    if i < 0:
        x = x[-i:]; i = 0
    k = min(len(x), N - i)
    y = x[:k] * db(gain_db)
    STEMS[stem][i:i + k] += y
    if hall:
        SENDS['hall'][i:i + k] += y * hall
    if delay:
        SENDS['delay'][i:i + k] += y * delay


# ------------------------------------------------------------------ harmony
# progressions as scale degrees (0-based) of the key; 1 chord per bar
PROG_MAJOR = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4]]
PROG_MINOR = [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 5, 3, 4]]
SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11]
SCALE_MIN = [0, 2, 3, 5, 7, 8, 10]
SCALE = SCALE_MAJ if MAJOR else SCALE_MIN
PROG = (PROG_MAJOR if MAJOR else PROG_MINOR)[SEED % 4]
BAR = BEAT * 4


def chord(deg, octave=0):
    """Triad + 9th on scale degree `deg`, as midi notes around ROOT."""
    notes = []
    for k in (0, 2, 4, 8):
        d = deg + k
        notes.append(ROOT + 12 * octave + SCALE[d % 7] + 12 * (d // 7))
    return notes


def chord_at(t):
    return PROG[int(t / BAR) % len(PROG)]


def energy(t):
    """0..1 arrangement energy along the clip (segments + mood)."""
    segs = TL['segs']
    n = len(segs)
    idx = max([i for i, s in enumerate(segs) if s['t0'] <= t] or [0])
    base = {'bright': 0.7, 'calm': 0.35, 'drive': 0.85, 'epic': 0.6, 'twist': 0.45}.get(MOOD, 0.6)
    if MOOD == 'twist':
        return 0.3 if idx < n - 2 else 1.0
    if MOOD == 'epic':
        return 0.4 + 0.6 * idx / max(1, n - 1)
    return base if idx > 0 else base * 0.8


def render_music():
    t = 0.0
    while t < DUR:
        deg = chord_at(t)
        ch = chord(deg)
        e = energy(t)
        x = supersaw_pad([m + 12 for m in ch[:3]], BAR + 0.6, RNG, voices=5, detune=0.12, bright=0.3 + 0.25 * e, attack=0.4 if e > 0.6 else 1.0, release=1.2)
        put('pad', x, t, -22 + 3 * e, hall=0.35)
        # bass
        root = ch[0] - 12 if ch[0] - 12 >= 36 else ch[0]
        if e >= 0.55:
            step = BEAT / 2 if e >= 0.8 else BEAT
            k = 0.0
            while k < BAR - 1e-6 and t + k < DUR:
                put('bass', bass_note(root, step * 0.85, RNG, drive=1.4, fc=500 + 400 * e), t + k, -15 + 2 * (k == 0))
                k += step
        else:
            put('bass', bass_note(root, BAR * 0.95, RNG, drive=1.1, fc=260), t, -18)
        # arpeggio
        if e >= 0.45:
            notes = sorted({m + 24 for m in ch[:3]} | {m + 36 for m in ch[:2]})
            seq = notes + notes[-2:0:-1]
            step = BEAT / 4 if e >= 0.75 else BEAT / 2
            k, j = 0.0, 0
            while k < BAR - 1e-6 and t + k < DUR:
                put('arp', pluck(seq[j % len(seq)], 0.25, RNG, bright=0.5 + 0.2 * e, decay=0.14), t + k, -24 + (1.5 if j % 4 == 0 else 0), p=0.35 * np.sin(j * 0.8), delay=0.2)
                k += step; j += 1
        # drums
        if e >= 0.6:
            for b in range(4):
                tb = t + b * BEAT
                if tb >= DUR:
                    break
                put('perc', kick(RNG, f0=120, f1=52, pd=0.04, decay=0.24, click=0.18), tb, -11 if e >= 0.8 else -14)
                if b % 2 == 1:
                    put('perc', clap(RNG), tb, -17, hall=0.15)
                for s in range(2 if e < 0.8 else 4):
                    put('perc', hat(RNG), tb + s * BEAT / (2 if e < 0.8 else 4), -29 + (2 if s == 0 else 0), p=0.25)
        t += BAR
    # a gentle piano figure on calm / epic beds
    if MOOD in ('calm', 'epic', 'twist'):
        t = BAR
        while t < DUR - BAR:
            ch = chord(chord_at(t))
            for j, m in enumerate([ch[2] + 12, ch[1] + 12, ch[0] + 24]):
                put('keys', felt_piano(m, 1.6, RNG, vel=0.45), t + j * BEAT * 0.75, -21, hall=0.4)
            t += BAR * 2


def load_ding():
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', DING_SRC, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    pk = int(np.argmax(np.abs(x[:int(0.3 * SR)]).max(axis=1)))
    a = max(0, pk - int(0.004 * SR))
    y = x[a:pk + int(0.33 * SR)].copy()
    nf = int(0.18 * SR)
    y[-nf:] *= (0.5 * (1 + np.cos(np.linspace(0, np.pi, nf))))[:, None]
    return y / np.abs(y).max(), pk - a


def render_sfx():
    for tr in TL['transitions']:
        d = tr['t1'] - tr['t0']
        if tr['type'] in ('zoom', 'wipe'):
            put('sfx', whoosh(max(0.45, d + 0.3), RNG, 400, 6000, -0.6, 0.6, 0.55), tr['t0'] - 0.12, -21)
        else:
            put('sfx', whoosh(0.4, RNG, 1500, 9000, 0.3, -0.3, 0.5), tr['t0'] - 0.05, -30)
    for i, sg in enumerate(TL['segs']):
        if i == 0:
            put('sfx', impact(RNG, size=0.55, tone=55.0), 0.35, -16)
            put('sfx', rev_swell(0.35, RNG, fc=3500), 0.0, -24)
        elif sg.get('caption'):
            put('sfx', blip(1760.0, RNG, dur=0.03, kind='sine', decay=0.02), sg['t0'] + 0.08, -31)
    last = TL['segs'][-1]
    put('sfx', riser(1.4, RNG, f0=400, f1=5000), max(0.0, last['t0'] - 1.4), -27)
    if os.path.exists(DING_SRC):
        d, off = load_ding()
        put('sfx', d, last['t0'] + 0.15 - off / SR, -17)


def render_voice():
    for sg in TL['segs']:
        if not sg.get('voFile'):
            continue
        x, sr = sf.read(os.path.join(RUN, sg['voFile']), always_2d=True)
        x = x.mean(axis=1)
        if sr != SR:
            x = signal.resample_poly(x, SR, sr)
        x = hp(x, 85, order=2)
        x = shelf(x, 3500, 2.5, 'high')
        # gentle leveller: 25 ms RMS follower, 3:1 above -20 dBFS
        env = np.sqrt(uniform_filter1d(x ** 2, int(0.025 * SR)) + 1e-12)
        lvl = 20 * np.log10(env)
        gr = np.where(lvl > -20, (lvl + 20) * (1 - 1 / 3), 0.0)
        x = x * db(-gr)
        put('voice', x, sg['voT'], -2.0)


VO_GAP = float(os.environ.get('VO_GAP', MUSIC.get('voice_over_music_lu', 18.0)))


def sidechain_from(x, depth_db=-7.0, smooth=0.12, lead=0.08):
    """Duck gain (linear, per sample) from the narration: starts `lead` s before the voice, ~120 ms glide."""
    env = maximum_filter1d(np.abs(x).max(axis=1), int(0.05 * SR))
    on = (env > 10 ** (-40 / 20)).astype(float)
    on = np.concatenate([on[int(lead * SR):], np.zeros(int(lead * SR))])
    a = np.exp(-1 / (smooth * SR))
    out = signal.lfilter([1 - a], [1, -a], on)
    return db(depth_db * np.clip(out, 0, 1))


def limiter(x, ceiling_db=-1.2, look=0.004, rel=0.06):
    ceiling = db(ceiling_db)
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(axis=1)
    peak = np.maximum(np.abs(x).max(axis=1), up[:len(x) * 4].reshape(-1, 4).max(axis=1)[:len(x)])
    g = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    w = int(look * SR)
    g = -maximum_filter1d(-g, size=2 * w + 1)
    g = uniform_filter1d(g, size=w)
    wr = int(rel * SR)
    g2 = uniform_filter1d(-maximum_filter1d(-g, size=wr), size=wr)
    return x * np.minimum(g, g2 * 0.5 + g * 0.5)[:, None]


def true_peak_db(x):
    return 20 * np.log10(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))) + 1e-12)


def load_music():
    """Decode the selected track, looping it when the clip is longer than the file."""
    source = Path(MUSIC['path'])
    if not source.is_absolute():
        source = ENGINE / source
    if not source.exists():
        print(f'WARNING: BGM not found ({source}) — rendering without music. '
              f'Point engine/music_config.json at your own track.', flush=True)
        return np.zeros((N, 2))
    start = float(MUSIC.get('start_seconds', 0))
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-stream_loop', '-1', '-ss', str(start),
                          '-i', str(source), '-t', str(DUR + .5),
                          '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    decoded = np.frombuffer(raw, np.float32).reshape(-1, 2)
    music = np.zeros((N, 2))
    count = min(N, len(decoded))
    music[:count] = decoded[:count] * db(float(MUSIC.get('gain_db', -20)))
    # Smooth entrance; the existing master envelope fades the ending.
    fade = min(int(.35 * SR), N)
    music[:fade] *= np.linspace(0, 1, fade)[:, None]
    return music


def main():
    music = load_music()
    render_sfx(); render_voice()
    voiced = np.abs(STEMS['voice']).max() > 1e-6
    gap = None
    if voiced:
        # duck depth from measurement: under the narration the bed sits VO_GAP LU below the voice
        meter0 = pyln.Meter(SR)
        on = maximum_filter1d(np.abs(STEMS['voice']).max(axis=1), int(0.05 * SR)) > 10 ** (-40 / 20)
        gap = meter0.integrated_loudness(STEMS['voice'][on]) - meter0.integrated_loudness(music[on])
        depth = min(-7.0, gap - VO_GAP)
        music = music * sidechain_from(STEMS['voice'], depth_db=depth)[:, None]
        gap = meter0.integrated_loudness(STEMS['voice'][on]) - meter0.integrated_loudness(music[on])
        # Attenuate the bed further if ducking ramps leave it above the target.
        if gap < VO_GAP:
            music *= db(gap - VO_GAP)
            gap = meter0.integrated_loudness(STEMS['voice'][on]) - meter0.integrated_loudness(music[on])
    # Apply the user's listening preset after ducking, so the original
    # 18 LU reference does not undo the approved +12 dB music increase.
    music_boost = float(MUSIC.get('post_duck_boost_db', 0))
    music *= db(music_boost)
    if gap is not None:
        gap -= music_boost
    mix = music + STEMS['sfx'] + STEMS['voice'] * (db(0) if voiced else 0)
    mix = hp(mix, 40, order=4)
    mix = shelf(mix, 100, -3.0, 'low')
    mix = softclip(mix * 0.9, 1.05) / 0.9
    mix = mix[:int(DUR * SR)]
    t = secs(len(mix))
    fe = np.clip((DUR - t) / 1.0, 0, 1) ** 1.2
    mix *= fe[:, None]
    meter = pyln.Meter(SR)
    mix *= db(-14.0 - meter.integrated_loudness(mix))
    for c in (-1.3, -1.6, -2.0, -2.5, -3.0):
        if true_peak_db(mix) <= -1.0:
            break
        mix = limiter(mix, ceiling_db=c)
    os.makedirs(os.path.join(RUN, 'audio'), exist_ok=True)
    sf.write(os.path.join(RUN, 'audio', 'mix.wav'), mix.astype(np.float32), SR, subtype='PCM_24')
    print(json.dumps({'music_title': MUSIC['title'], 'music_path': MUSIC['path'], 'lufs': round(meter.integrated_loudness(mix), 2),
                      'music_preset': MUSIC.get('preset', 'default'), 'music_boost_db': music_boost,
                      'true_peak_db': round(true_peak_db(mix), 2), 'seconds': round(len(mix) / SR, 3), 'voiced': bool(voiced),
                      'voice_over_music_lu': None if gap is None else round(gap, 1)}))


if __name__ == '__main__':
    main()
