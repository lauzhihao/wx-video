"""Concatenate voice/segNN.wav, transcribe on dev-server Whisper, compare with the spoken text.

usage: python tools/asr_check.py <run_dir>      -> voice/asr_check.json, prints OK or the suspicious segments
Flags a segment for similarity < 0.85, an unexpected 负 (minus), stale spoken-text cache,
or unresolved word ownership. Subtitles still align to the original `vo` copy.
Fix pronunciation with a `say` field in spec.json, then re-run TTS and this check.
"""
import difflib
import json
import math
import os
import re
import shlex
import subprocess
import sys

import numpy as np
import soundfile as sf

from tts import speakable

try:
    from opencc import OpenCC
    T2S = OpenCC('t2s')
except ImportError:
    T2S = None

# Transcript command: must accept <wav> --out <json> --language --model --flat.
# Leave unset to skip the listen-back check (make.sh treats it as optional).
WHISPER_CMD = os.environ.get('WX_WHISPER_CMD', '')
GAP = 1.5


def t2s(text):
    """Traditional -> simplified. Whisper on zh often returns traditional; the copy never is."""
    return T2S.convert(str(text)) if T2S is not None else str(text)


def norm(text):
    return re.sub(r'[\s\W_]+', '', t2s(text)).lower()


def make_marks(wav_lengths):
    """Use actual WAV frame counts/rates, including the concatenation gap frames."""
    marks, seen, t = [], set(), 0.0
    for i, frames, sr in wav_lengths:
        if i in seen or frames <= 0 or sr <= 0:
            raise ValueError(f'invalid or duplicate narration segment: {i}')
        seen.add(i)
        end = t + frames / sr
        marks.append((i, t, end))
        t = end + int(GAP * sr) / sr
    return marks


def assign_words(words, marks):
    """Assign each word once by maximum positive overlap; preserve legacy fallback."""
    owned = {i: [] for i, _, _ in marks}
    diagnostics = []
    for index, word in enumerate(words):
        row = {'word_index': index, 'word': word.get('word', '')}
        try:
            start, end = float(word['start']), float(word['end'])
            if not math.isfinite(start) or not math.isfinite(end) or end < start:
                raise ValueError('non-finite or reversed word times')
            if not isinstance(word.get('word', ''), str):
                raise ValueError('word text is not a string')
        except (KeyError, TypeError, ValueError) as error:
            row.update(status='invalid', reason=str(error))
            diagnostics.append(row)
            continue
        row.update(start=start, end=end)
        overlaps = [(i, max(0.0, min(end, b) - max(start, a))) for i, a, b in marks]
        maximum = max((overlap for _, overlap in overlaps), default=0.0)
        if maximum > 0:
            # A nanosecond tolerance only resolves floating-point equality, not an ordering tie.
            candidates = [i for i, overlap in overlaps
                          if overlap > 0 and math.isclose(overlap, maximum, rel_tol=0, abs_tol=1e-9)]
            row.update(method='overlap', overlap=maximum)
        else:
            candidates = [i for i, a, b in marks if a - 0.3 <= start < b + 0.3]
            row.update(method='legacy_start_window')
        row['candidates'] = candidates
        if len(candidates) == 1:
            i = candidates[0]
            owned[i].append(word)
            row.update(status='assigned', seg=i)
        else:
            row['status'] = 'ambiguous' if candidates else 'unassigned'
        diagnostics.append(row)
    return owned, diagnostics


def expected_for_segment(segment, voice_segment):
    """Check the cached TTS text against the same pronunciation pass used by tts.py."""
    spec_spoken = speakable((segment.get('say') or segment.get('vo') or '').strip())
    cached = voice_segment.get('text')
    if cached is not None and not isinstance(cached, str):
        raise ValueError(f"narration cache text is not a string for seg{voice_segment['i']}")
    if cached and cached.strip():
        return cached, 'voice.json:text', cached != spec_spoken, spec_spoken
    source = 'spec:speakable(say)' if segment.get('say') else 'spec:speakable(vo)'
    return spec_spoken, source, False, spec_spoken


def caption_alignment(copy, owned_words, start, end):
    """One local time per original caption char, using the report's word ownership."""
    duration = end - start
    clamp = lambda value: max(0.0, min(duration, value))
    heard_chars, heard_times = [], []
    for word in owned_words:
        s0, s1 = float(word['start']), float(word['end'])
        chars = norm(word.get('word', ''))
        for k, char in enumerate(chars):
            heard_chars.append(char)
            heard_times.append(clamp(s0 - start + (s1 - s0) * k / len(chars)))
    caption_chars = norm(copy.replace('-', ''))
    if not caption_chars or not heard_chars:
        return None
    times = [None] * len(caption_chars)
    for match in difflib.SequenceMatcher(None, caption_chars, ''.join(heard_chars), autojunk=False).get_matching_blocks():
        for k in range(match.size):
            times[match.a + k] = heard_times[match.b + k]
    known = [(k, value) for k, value in enumerate(times) if value is not None]
    if len(known) < 2:
        return None
    for k in range(len(caption_chars)):
        if times[k] is None:
            lo = max((p for p in known if p[0] < k), default=(-1, 0.0), key=lambda p: p[0])
            hi = min((p for p in known if p[0] > k), default=(len(caption_chars), duration), key=lambda p: p[0])
            times[k] = clamp(lo[1] + (hi[1] - lo[1]) * (k - lo[0]) / (hi[0] - lo[0]))
    for k in range(1, len(caption_chars)):
        times[k] = clamp(max(times[k], times[k - 1]))
    # Clamp after rounding too: the exact final WAV frame can fall between milliseconds.
    return [clamp(round(value, 3)) for value in times]


def analyse_narration(spec, voice, marks, words):
    """Pure replay entry point; no synthesis, transcription, or file writes."""
    owned, diagnostics = assign_words(words, marks)
    issues = [row for row in diagnostics if row['status'] != 'assigned']
    voice_segments = {segment['i']: segment for segment in voice['segments']}
    report, align = [], {}
    for i, start, end in marks:
        segment = spec['segments'][i]
        copy = segment.get('vo') or ''
        heard = ''.join(word.get('word', '') for word in owned[i])
        expected, source, cache_mismatch, spec_spoken = expected_for_segment(segment, voice_segments[i])
        ratio = difflib.SequenceMatcher(None, norm(expected.replace('-', '')), norm(heard)).ratio()
        caption_ratio = difflib.SequenceMatcher(None, norm(copy.replace('-', '')), norm(heard)).ratio()
        minus = '负' in t2s(heard) and '负' not in t2s(copy)
        ok = ratio >= 0.85 and not minus and not cache_mismatch and not issues
        report.append({'seg': i, 'ok': ok, 'similarity': round(ratio, 3), 'minus': minus,
                       'copy': copy, 'heard': heard, 'expected_spoken': expected,
                       'expected_source': source, 'caption_similarity': round(caption_ratio, 3),
                       'cache_mismatch': cache_mismatch, 'spec_spoken': spec_spoken,
                       'assigned_words': len(owned[i]), 'word_assignment_ok': not issues,
                       'word_assignment_issues': issues})
        times = caption_alignment(copy, owned[i], start, end)
        if times is not None:
            align[str(i)] = times
    return report, align, diagnostics


def main():
    if not WHISPER_CMD:
        print('SKIP asr_check: set WX_WHISPER_CMD to a Whisper wrapper that writes word timings')
        return
    if T2S is None:
        raise SystemExit('繁简归一需要 opencc：.venv/bin/pip install opencc-python-reimplemented')
    run = os.path.abspath(sys.argv[1])
    with open(os.path.join(run, 'voice', 'voice.json'), encoding='utf-8') as stream:
        voice = json.load(stream)
    with open(os.path.join(run, 'spec.json'), encoding='utf-8') as stream:
        spec = json.load(stream)
    parts, wav_lengths, sample_rate = [], [], None
    for segment in voice['segments']:
        audio, sr = sf.read(os.path.join(run, segment['file']), always_2d=True)
        if sample_rate is not None and sr != sample_rate:
            raise ValueError('narration WAV sample rates differ; cannot concatenate without resampling')
        sample_rate = sr
        audio = audio.mean(axis=1)
        parts += [audio, np.zeros(int(GAP * sr))]
        wav_lengths.append((segment['i'], len(audio), sr))
    marks = make_marks(wav_lengths)
    if not marks:
        raise ValueError('no narration WAV segments')
    cat = os.path.join(run, 'voice', '_all.wav')
    sf.write(cat, np.concatenate(parts).astype(np.float32), sample_rate, subtype='PCM_16')
    out = os.path.join(run, 'voice', 'asr.json')
    subprocess.run(shlex.split(WHISPER_CMD) + [cat, '--out', out,
                    '--language', 'zh', '--model', 'medium', '--flat'],
                   check=True, capture_output=True, text=True)
    os.remove(cat)
    with open(out, encoding='utf-8') as stream:
        data = json.load(stream)
    words = ([word for segment in data.get('segments', []) for word in segment.get('words', [])]
             if data.get('segments') else data.get('words', []))
    report, align, _ = analyse_narration(spec, voice, marks, words)
    with open(os.path.join(run, 'voice', 'asr_check.json'), 'w', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=1)
    with open(os.path.join(run, 'voice', 'align.json'), 'w', encoding='utf-8') as stream:
        json.dump(align, stream)
    for row in report:
        print(('OK  ' if row['ok'] else 'FLAG'), f"seg{row['seg']} sim={row['similarity']}",
              '' if row['ok'] else f"\n     copy : {row['copy']}\n     expected: {row['expected_spoken']}\n     heard: {row['heard']}")
        if row['cache_mismatch']:
            print(f"     cache mismatch; current spec spoken: {row['spec_spoken']}")
    issues = report[0]['word_assignment_issues'] if report else []
    if issues:
        print('     word assignment issues:', json.dumps(issues, ensure_ascii=False))


if __name__ == '__main__':
    main()
