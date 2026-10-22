"""DSP building blocks for the QJ ROBOTS score. Everything is rendered offline with numpy/scipy.

All generators return float64 mono arrays at SR unless noted; stereo arrays are (n, 2).
Randomness always comes from an explicit numpy Generator so renders are reproducible.
"""
import numpy as np
from scipy import signal

SR = 48000


def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def secs(n):
    return np.arange(n) / SR


def db(x):
    return 10.0 ** (x / 20.0)


# ---------------------------------------------------------------- oscillators
def _polyblep(ph, dt):
    y = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] = x + x - x * x - 1.0
    m = ph > 1.0 - dt
    x = (ph[m] - 1.0) / dt[m]
    y[m] = x * x + x + x + 1.0
    return y


def phase_of(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    return ph, np.maximum(dt, 1e-9)


def saw(freq, n, phase0=0.0):
    ph, dt = phase_of(freq, n, phase0)
    return 2.0 * ph - 1.0 - _polyblep(ph, dt)


def square(freq, n, phase0=0.0, pw=0.5):
    ph, dt = phase_of(freq, n, phase0)
    ph2 = (ph + (1.0 - pw)) % 1.0
    a = 2.0 * ph - 1.0 - _polyblep(ph, dt)
    b = 2.0 * ph2 - 1.0 - _polyblep(ph2, dt)
    return 0.5 * (a - b)


def sine(freq, n, phase0=0.0):
    ph, _ = phase_of(freq, n, phase0)
    return np.sin(2 * np.pi * ph)


def tri(freq, n, phase0=0.0):
    ph, _ = phase_of(freq, n, phase0)
    return 1.0 - 4.0 * np.abs(ph - 0.5)


# ---------------------------------------------------------------- envelopes
def adsr(n, a=0.01, d=0.1, s=0.7, r=0.3, hold=None):
    """hold = seconds the gate is open (default: n minus release)."""
    t = secs(n)
    hold = (n / SR - r) if hold is None else hold
    e = np.empty(n)
    e[:] = s
    ma = t < a
    e[ma] = t[ma] / max(a, 1e-6)
    md = (t >= a) & (t < a + d)
    e[md] = 1.0 - (1.0 - s) * (t[md] - a) / max(d, 1e-6)
    mr = t >= hold
    lvl = np.interp(hold, [0, a, a + d, 1e9], [0, 1, s, s])
    e[mr] = lvl * np.exp(-(t[mr] - hold) / max(r / 4.0, 1e-4))
    return e


def perc(n, a=0.002, decay=0.3):
    t = secs(n)
    return np.minimum(1.0, t / max(a, 1e-6)) * np.exp(-t / decay)


def fade(x, fi=0.005, fo=0.01):
    n = len(x)
    y = x.copy()
    ni, no = int(fi * SR), int(fo * SR)
    if ni > 0:
        y[:ni] *= np.linspace(0, 1, ni) if y.ndim == 1 else np.linspace(0, 1, ni)[:, None]
    if no > 0:
        y[n - no:] *= np.linspace(1, 0, no) if y.ndim == 1 else np.linspace(1, 0, no)[:, None]
    return y


# ---------------------------------------------------------------- filters
def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def hp(x, fc, order=2):
    sos = signal.butter(order, max(fc, 5), 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [max(lo, 5), min(hi, SR * 0.45)], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def _biquad(kind, fc, q):
    w0 = 2 * np.pi * np.clip(fc, 10, SR * 0.45) / SR
    c, s = np.cos(w0), np.sin(w0)
    alpha = s / (2 * q)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # band-pass, constant peak gain
        b = [alpha, 0.0, -alpha]
    a = [1 + alpha, -2 * c, 1 - alpha]
    return np.array([b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]])


def sweep(x, fc_curve, q=0.8, kind='lp', block=128):
    """Time-varying biquad: fc_curve is an array (Hz) with len(x) samples."""
    y = np.zeros_like(x)
    zi = np.zeros((1, 2))
    for i in range(0, len(x), block):
        sos = _biquad(kind, float(fc_curve[min(i + block // 2, len(x) - 1)]), q)[None, :]
        y[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return y


# ---------------------------------------------------------------- spatial
def pan(x, p=0.0, width=0.0):
    """Equal-power pan of a mono signal; p in [-1, 1]."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)


def stereo(l, r):
    return np.stack([l, r], axis=1)


def haas(x, ms=12.0, p=0.0):
    d = int(ms / 1000 * SR)
    l = x
    r = np.concatenate([np.zeros(d), x[:-d]]) if d > 0 else x
    s = stereo(l, r) if p >= 0 else stereo(r, l)
    return s


# ---------------------------------------------------------------- effects
def make_ir(seconds=3.4, rt60=2.8, seed=1, predelay=0.018, bright=1.0):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = secs(n)
    bands = [(20, 200, 1.25), (200, 900, 1.05), (900, 3000, 0.85), (3000, 7000, 0.6), (7000, 18000, 0.38 * bright)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for lo, hi, k in bands:
            b = bp(noise, lo, hi, order=2)
            acc += b * np.exp(-6.91 * t / (rt60 * k))
        # smooth onset (diffusion build-up) and early reflections
        acc *= 1 - np.exp(-t / 0.012)
        for tap, g in ((0.011, 0.5), (0.019, 0.38), (0.027, 0.3), (0.041, 0.22), (0.057, 0.16)):
            i = int((tap + rng.uniform(0, 0.004)) * SR)
            acc[i] += g * (1 if rng.random() > 0.5 else -1) * 3.0
        ir[:, ch] = acc
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((pd, 2)), ir])
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


def convolve_st(x, ir):
    out = np.zeros((len(x) + len(ir) - 1, 2))
    for ch in range(2):
        out[:, ch] = signal.fftconvolve(x[:, ch], ir[:, ch])
    return out[:len(x)]


def pingpong(x, delay, fb=0.4, taps=6, tone=4000.0):
    """x stereo; returns wet only."""
    d = int(delay * SR)
    y = np.zeros_like(x)
    cur = lp(x.mean(axis=1), tone)
    for k in range(1, taps + 1):
        g = fb ** k
        ch = k % 2
        if d * k >= len(x):
            break
        y[d * k:, ch] += cur[:len(x) - d * k] * g
        cur = lp(cur, tone)
    return y


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def bitcrush(x, bits=5, hold=6):
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    idx = (np.arange(len(y)) // hold) * hold
    return y[idx]


# ---------------------------------------------------------------- instruments
def supersaw_pad(midis, dur, rng, voices=5, detune=0.14, bright=0.45, attack=1.2, release=2.5, air=0.15):
    n = int((dur + release) * SR)
    ch = []
    for side in range(2):
        acc = np.zeros(n)
        for m in midis:
            f0 = float(midi_hz(m))
            for v in range(voices):
                det = ((v - (voices - 1) / 2) / max(1, (voices - 1) / 2)) * detune
                acc += saw(f0 * 2 ** (det / 12) * (1 + rng.uniform(-0.0006, 0.0006)), n, rng.random())
        acc /= np.sqrt(len(midis) * voices)
        fc = 250 + bright * 3200
        lfo = 1 + 0.18 * np.sin(2 * np.pi * (0.07 + 0.02 * side) * secs(n) + rng.random() * 6)
        acc = sweep(acc, fc * lfo, q=0.7, kind='lp', block=256)
        acc = lp(acc, fc * 2.2)
        ch.append(acc)
    x = stereo(ch[0], ch[1])
    if air > 0:
        noise = rng.standard_normal((n, 2))
        x += bp(noise, 5000, 12000) * air * 0.08
    env = adsr(n, a=attack, d=0.5, s=0.9, r=release, hold=dur)
    return x * env[:, None]


def felt_piano(midi, dur, rng, vel=0.8):
    f0 = float(midi_hz(midi))
    n = int((dur + 1.5) * SR)
    t = secs(n)
    x = np.zeros(n)
    B = 0.00035
    for k in range(1, 14):
        fk = f0 * k * np.sqrt(1 + B * k * k)
        if fk > SR * 0.42:
            break
        amp = (1.0 / k ** 1.15) * (0.6 + 0.4 * vel) * (1.0 if k < 3 else vel)
        dec = 2.8 / (1 + 0.55 * (k - 1)) * (1.2 - 0.004 * (midi - 60))
        x += amp * np.sin(2 * np.pi * fk * t + rng.random() * 6) * np.exp(-t / max(0.08, dec))
    ham = lp(rng.standard_normal(n) * np.exp(-t / 0.006), 2200) * 0.08 * vel
    x += ham
    x *= np.minimum(1.0, t / 0.004)
    rel = np.clip((dur - t) / 0.25 + 1.0, 0, 1)
    x *= 0.35 + 0.65 * rel
    x = lp(x, 900 + 3500 * vel)
    return x * 0.5


def bell(freq, dur, rng, bright=1.0, decay=1.4):
    n = int(dur * SR)
    t = secs(n)
    x = np.zeros(n)
    parts = [(1.0, 1.0, 1.0), (2.0, 0.55, 0.8), (2.76, 0.42, 0.62), (3.9, 0.25, 0.45), (5.4, 0.2 * bright, 0.32), (6.8, 0.12 * bright, 0.25), (8.93, 0.08 * bright, 0.18)]
    for r, a, d in parts:
        f = freq * r
        if f > SR * 0.42:
            continue
        x += a * np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t / (decay * d))
    x *= np.minimum(1.0, t / 0.0015)
    return x * 0.4


def pluck(midi, dur, rng, bright=0.6, decay=0.35):
    f = float(midi_hz(midi))
    n = int((dur + 0.6) * SR)
    t = secs(n)
    raw = 0.65 * saw(f, n, rng.random()) + 0.35 * square(f * 1.002, n, rng.random(), 0.35)
    brightv = lp(raw, 1800 + 5200 * bright, order=2)
    darkv = lp(raw, 700 + 600 * bright, order=2)
    e_fast = np.exp(-t / (0.06 + 0.05 * bright))
    e_slow = np.exp(-t / decay)
    x = brightv * e_fast * 0.6 + darkv * e_slow
    x *= np.minimum(1.0, t / 0.002)
    return x * 0.45


def bass_note(midi, dur, rng, drive=1.4, fc=320):
    f = float(midi_hz(midi))
    n = int((dur + 0.12) * SR)
    t = secs(n)
    x = 0.8 * np.sin(2 * np.pi * f * t) + 0.45 * lp(saw(f, n, rng.random()), fc)
    x = softclip(x, drive)
    env = adsr(n, a=0.006, d=0.12, s=0.8, r=0.1, hold=dur)
    return x * env * 0.6


def kick(rng, f0=150, f1=44, pd=0.045, decay=0.36, click=0.25, n_s=0.7):
    n = int(n_s * SR)
    t = secs(n)
    f = f1 + (f0 - f1) * np.exp(-t / pd)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / decay)
    cl = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.003) * click
    return softclip(body * 1.1 + cl, 1.6) * 0.9


def snare(rng, tone=190, decay=0.17, n_s=0.6):
    n = int(n_s * SR)
    t = secs(n)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.07) * 0.6 + np.sin(2 * np.pi * tone * 1.6 * t) * np.exp(-t / 0.05) * 0.25
    nz = bp(rng.standard_normal(n), 1400, 9500) * np.exp(-t / decay)
    return softclip(body + nz * 0.9, 1.3) * 0.7


def clap(rng, n_s=0.5):
    n = int(n_s * SR)
    t = secs(n)
    x = np.zeros(n)
    nz = bp(rng.standard_normal(n), 900, 6000)
    for k, off in enumerate([0.0, 0.011, 0.021, 0.032]):
        i = int(off * SR)
        env = np.zeros(n)
        env[i:] = np.exp(-(t[:n - i]) / (0.008 if k < 3 else 0.18))
        x += nz * env
    return x * 0.6


def hat(rng, open_=False, n_s=None):
    dec = 0.25 if open_ else 0.035
    n = int((n_s or (dec * 6)) * SR)
    t = secs(n)
    nz = rng.standard_normal(n)
    metal = sum(square(f, n, rng.random()) for f in (3150, 4170, 5260, 6570, 8120)) / 5
    x = hp(nz * 0.6 + metal * 0.5, 7000, order=3) * np.exp(-t / dec)
    return x * 0.5


def tom(rng, f0=140, f1=85, decay=0.35):
    n = int(1.0 * SR)
    t = secs(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.06)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    x += bp(rng.standard_normal(n), 200, 1500) * np.exp(-t / 0.05) * 0.2
    return softclip(x, 1.4) * 0.7


def impact(rng, size=1.0, tone=36.7):
    """Cinematic hit: sub boom + mid thump + noise burst + metal ring. Returns stereo."""
    n = int(5.0 * SR)
    t = secs(n)
    f = tone * 0.8 + (tone * 2.2) * np.exp(-t / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (1.6 * size))
    thump = softclip(np.sin(2 * np.pi * np.cumsum(110 * np.exp(-t / 0.08) + 55) / SR) * np.exp(-t / 0.22), 2.5) * 0.6
    nz = lp(rng.standard_normal(n), 3500) * np.exp(-t / 0.25) * 0.5
    metal = sum(np.sin(2 * np.pi * fr * t + rng.random() * 6) * np.exp(-t / d) for fr, d in ((233.1, 1.8), (311.0, 1.2), (466.2, 0.9), (622.3, 0.6), (987.8, 0.4))) * 0.08
    mono = sub * 1.0 + thump + nz + metal
    wide = stereo(bp(rng.standard_normal(n), 400, 6000) * np.exp(-t / 0.35), bp(rng.standard_normal(n), 400, 6000) * np.exp(-t / 0.35)) * 0.18
    return (pan(mono, 0) / np.sqrt(2) + wide) * size


def braam(midis, dur, rng, open_t=0.35):
    n = int((dur + 1.0) * SR)
    t = secs(n)
    chs = []
    for side in range(2):
        acc = np.zeros(n)
        for m in midis:
            f = float(midi_hz(m))
            for d in (-0.12, 0.0, 0.11):
                acc += saw(f * 2 ** (d / 12), n, rng.random())
        fc = 180 + 2600 * np.exp(-((t - open_t) / 0.45) ** 2) * (t > 0.02) + 400 * np.exp(-t / 1.5)
        acc = sweep(acc / np.sqrt(len(midis) * 3), fc, q=1.1, kind='lp', block=256)
        chs.append(softclip(acc * 1.6, 1.5))
    env = adsr(n, a=0.03, d=0.6, s=0.55, r=1.0, hold=dur)
    return stereo(chs[0], chs[1]) * env[:, None] * 0.5


def riser(dur, rng, f0=300.0, f1=9000.0, tone=True):
    n = int(dur * SR)
    t = secs(n)
    u = t / dur
    fc = f0 * (f1 / f0) ** (u ** 1.6)
    nz = rng.standard_normal((n, 2))
    x = np.stack([sweep(nz[:, 0], fc, q=1.6, kind='bp'), sweep(nz[:, 1], fc * 1.03, q=1.6, kind='bp')], axis=1)
    if tone:
        ft = 180 * (8.0 ** (u ** 1.3))
        tn = 0.35 * saw(ft, n) + 0.3 * saw(ft * 1.5, n)
        tn = lp(tn, 5000)
        x += pan(tn, 0) * 0.25
    env = (u ** 2.2)
    return x * env[:, None] * 0.6


def whoosh(dur, rng, f_lo=250.0, f_hi=4200.0, pan_from=-0.8, pan_to=0.8, peak=0.55):
    n = int(dur * SR)
    t = secs(n)
    u = t / dur
    fc = np.where(u < peak, f_lo + (f_hi - f_lo) * np.clip(u / peak, 0, 1) ** 1.5, f_hi - (f_hi - f_lo) * np.clip((u - peak) / (1 - peak), 0, 1) ** 0.7)
    nz = rng.standard_normal(n)
    x = sweep(nz, fc, q=0.9, kind='bp')
    env = np.where(u < peak, (u / peak) ** 2.0, np.exp(-(u - peak) / (1 - peak) * 4))
    x = x * env
    p = pan_from + (pan_to - pan_from) * u
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * 1.2


def rev_swell(dur, rng, fc=2500.0):
    n = int(dur * SR)
    t = secs(n)
    u = t / dur
    nz = hp(rng.standard_normal((n, 2)), fc)
    env = np.exp((u - 1) * 5.0) * u
    return nz * env[:, None] * 0.6


def sub_drop(dur=1.2, f0=90.0, f1=28.0):
    n = int(dur * SR)
    t = secs(n)
    f = f1 + (f0 - f1) * np.exp(-t / (dur * 0.35))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur * 0.6))


def blip(freq, rng, dur=0.09, kind='sine', decay=0.05):
    n = int((dur + 0.05) * SR)
    t = secs(n)
    if kind == 'tri':
        x = tri(freq, n)
    elif kind == 'square':
        x = lp(square(freq, n), 5000)
    else:
        x = sine(freq, n)
    x = x * np.minimum(1.0, t / 0.002) * np.exp(-t / decay)
    return x * 0.5


def fm_tone(fc, ratio, index, dur, rng, decay=0.4, idx_decay=0.15):
    n = int(dur * SR)
    t = secs(n)
    mod = np.sin(2 * np.pi * fc * ratio * t) * index * np.exp(-t / idx_decay)
    x = np.sin(2 * np.pi * fc * t + mod)
    return x * np.minimum(1.0, t / 0.002) * np.exp(-t / decay) * 0.5


def glitch(dur, rng):
    n = int(dur * SR)
    out = np.zeros(n)
    i = 0
    while i < n:
        seg = int(rng.uniform(0.012, 0.05) * SR)
        f = rng.choice([220, 330, 440, 660, 880, 1320, 1760]) * rng.uniform(0.98, 1.02)
        kind = rng.integers(0, 3)
        m = min(seg, n - i)
        if kind == 0:
            s = square(f, m)
        elif kind == 1:
            s = rng.standard_normal(m)
        else:
            s = saw(f * 0.5, m)
        s = bitcrush(s, bits=int(rng.integers(3, 6)), hold=int(rng.integers(2, 12)))
        reps = int(rng.integers(1, 4))
        for r in range(reps):
            j = i + r * m
            if j >= n:
                break
            k = min(m, n - j)
            out[j:j + k] += s[:k] * (0.8 ** r)
        i += m * reps
    return out * 0.35


def servo(dur, rng, f0=120.0):
    n = int(dur * SR)
    t = secs(n)
    f = f0 * (1 + 0.04 * np.sin(2 * np.pi * 11 * t)) * (1 + 0.15 * np.minimum(1, t / 0.4))
    x = saw(f, n) * 0.6 + square(f * 2.01, n) * 0.3
    x = bp(x, 400, 2600)
    return x * adsr(n, a=0.08, d=0.1, s=0.9, r=0.12) * 0.3


def ping(freq, rng, decay=0.7):
    n = int((decay * 5) * SR)
    t = secs(n)
    f = freq * (1 - 0.03 * (1 - np.exp(-t / 0.05)))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * np.exp(-t / 0.2)
    return x * np.minimum(1, t / 0.001) * np.exp(-t / decay) * 0.5


def scribble(dur, rng, level=1.0):
    n = int(dur * SR)
    t = secs(n)
    nz = rng.standard_normal(n)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * (3.1 * t + 0.6 * np.sin(2 * np.pi * 0.7 * t)))
    fc = 1800 + 2500 * lfo
    x = sweep(nz, fc, q=2.5, kind='bp', block=256)
    grain = (np.sin(2 * np.pi * 23 * t) > 0.2).astype(float) * 0.5 + 0.5
    return x * grain * 0.25 * level


def shelf(x, fc, gain_db, kind='low', slope=0.8):
    """RBJ shelving filter."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    c, s = np.cos(w0), np.sin(w0)
    alpha = s / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
    sq = 2 * np.sqrt(A) * alpha
    if kind == 'low':
        b0, b1, b2 = A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)
        a0, a1, a2 = (A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq
    else:
        b0, b1, b2 = A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)
        a0, a1, a2 = (A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq
    sos = np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])
    return signal.sosfilt(sos, x, axis=0)
