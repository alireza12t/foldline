"""Qwen3-TTS voice, local on a Mac with Apple silicon (MLX), free: python core/tts/tts_qwen.py lines.json out_dir [options]
lines.json = [{"id":..., "text":..., "voice":"ryan", "instruct":"...", "lang":"english", "say":..., "asr":...}, ...]
  voice    a built-in voice, best in the language named: ryan, aiden (English); vivian, serena, uncle_fu, dylan, eric
           (Chinese); ono_anna (Japanese); sohee (Korean). Default --voice (ryan).
  instruct how to say it, in plain words ("warm, clear narrator, natural pace"). Default --instruct (none).
  lang     english (default), chinese, japanese, korean, german, french, russian, portuguese, spanish, italian.
  say      what is spoken when it differs from text. asr: what Whisper should hear when it differs from what is spoken.
Writes out_dir/<id>.wav (24 kHz mono, silence trimmed, 10 ms fade at the end) and out_dir/dur.json.

Options: --voice ryan  --instruct ""  --batch 16  --retries 3  --no-check  --check-model small.en  --seed N
         --model mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit (a Hugging Face repo or a local folder)

What it fixes on top of the plain model:
  - Cut endings. Qwen3-TTS often picks its end token while the last sound is still loud, so 1 take in 4 to 7 stops
    mid-sound. Every take makes one more frame after the model's first end attempt (qwen_batch.py, eos_hold), and
    gets a 10 ms fade at the end.
  - Numbers. Digits are read one token at a time and the reading is guessed (years come out wrong or rushed), so
    English digits are spelled as words before generation (num_words.py). Write digits in the subtitles as usual.
  - A guard that redoes bad takes. Every take is checked for a cut end (voice still in the last 50 ms) and, in
    English, by Whisper (take_check.py: every number heard, last word heard, word accuracy >= 0.85, no rushed
    number). Failing takes are made again, up to --retries rounds. A line that still fails keeps its best try and
    is named as STILL FAILING: listen to it, then reword the line or set its "asr". --no-check keeps the cut check only.

Model: downloaded from Hugging Face on first use (about 3.1 GB, into ~/.cache/huggingface). Whisper small.en for the
check, about 0.5 GB. Peak memory about 4.5 GB at batch 16; a lower --batch uses less.
Install: sh plugin/skills/lemo-opuscar/scripts/setup.sh deps qwen   (Python 3.11-3.13, macOS on Apple silicon)
"""
import argparse, json, os, platform, re, sys, time
REPO = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'
SR = 24000
LANGS = ('english', 'chinese', 'japanese', 'korean', 'german', 'french', 'russian', 'portuguese', 'spanish', 'italian')
SETUP = 'sh plugin/skills/lemo-opuscar/scripts/setup.sh deps qwen'


def trim(x, sr=SR, thresh=0.01, head=0.010, tail=0.100):
    """Leading and trailing silence off: keep 10 ms before the first and 100 ms after the last sample above 1% of the peak."""
    import numpy as np
    if len(x) == 0: return x
    a = np.abs(x); idx = np.where(a > (a.max() + 1e-9) * thresh)[0]
    if len(idx) == 0: return x
    return x[max(0, idx[0] - int(head * sr)):min(len(x), idx[-1] + int(tail * sr))]


def fade_end(x, sr=SR, ms=10):
    import numpy as np
    n = min(len(x), int(sr * ms / 1000)); x = x.copy(); x[len(x) - n:] *= np.linspace(1.0, 0.0, n, dtype=np.float32); return x


def clipped(x, sr=SR):
    """Voice still in the last 50 ms after the trim: the take stops while a sound is playing (or it is under 0.2 s)."""
    import numpy as np
    if len(x) < sr // 5: return True
    tail = x[-int(0.05 * sr):]
    return float(np.sqrt((tail ** 2).mean())) > 0.08 * float(np.sqrt((x ** 2).mean()))


def main():
    ap = argparse.ArgumentParser(prog='tts_qwen.py', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('lines'); ap.add_argument('out')
    ap.add_argument('--voice', default='ryan'); ap.add_argument('--instruct', default=None)
    ap.add_argument('--batch', type=int, default=16, help='lines generated together (default 16)')
    ap.add_argument('--retries', type=int, default=3, help='rounds of redoing failed takes (default 3)')
    ap.add_argument('--no-check', action='store_true', help='skip the Whisper check (the cut check still runs)')
    ap.add_argument('--check-model', default='small.en', help='faster-whisper model for the check (default small.en)')
    ap.add_argument('--seed', type=int, default=None); ap.add_argument('--model', default=REPO)
    a = ap.parse_args()

    # check the input first, then load the model (loading takes a few seconds, the first download a few minutes)
    try: lines = json.load(open(a.lines, encoding='utf-8'))
    except (OSError, ValueError) as e: sys.exit(f'tts_qwen.py: cannot read {a.lines}: {e}')
    if not isinstance(lines, list) or not lines or not all(isinstance(L, dict) and L.get('id') and str(L.get('text', '')).strip() for L in lines):
        sys.exit('tts_qwen.py: lines.json must be a list of {"id", "text"} objects, each with an id and some text')
    ids = [str(L['id']) for L in lines]
    if len(set(ids)) < len(ids): sys.exit(f"tts_qwen.py: repeated id(s): {', '.join(sorted({i for i in ids if ids.count(i) > 1}))}")
    if a.batch < 1 or a.retries < 0: sys.exit('tts_qwen.py: --batch must be 1 or more, --retries 0 or more')
    for L in lines:
        L['id'] = str(L['id']); L['text'] = str(L['text'])
        v = L.get('voice') or a.voice; L['_voice'] = (v[0] if isinstance(v, list) else v).lower()
        L['_lang'] = (L.get('lang') or 'english').lower()
        if L['_lang'] not in LANGS: sys.exit(f"tts_qwen.py: line '{L['id']}' has lang '{L['_lang']}'. Qwen3-TTS speaks: {', '.join(LANGS)}")
        L['_ins'] = L.get('instruct', a.instruct) or None
    if not (sys.platform == 'darwin' and platform.machine() == 'arm64'):
        sys.exit('tts_qwen.py: the Qwen engine runs on MLX, which needs a Mac with Apple silicon. Use core/tts/tts.py (Kokoro) here.')
    try:
        import numpy as np, soundfile as sf
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model
        from mlx_audio.utils import get_model_path
    except ImportError as e:
        sys.exit(f'tts_qwen.py: {e.name or e} is missing: install the Qwen tier: {SETUP}   (from the library root)')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import qwen_batch
    from num_words import spell

    def spoken(L):
        s = L.get('say') or L['text']
        return spell(s) if L['_lang'] == 'english' else s     # digits -> words (English only)

    def expected(L):
        s = L.get('asr') or spoken(L)
        return spell(s) if L['_lang'] == 'english' else s

    t0 = time.time()
    local = os.path.isdir(os.path.expanduser(a.model))
    if not local: print(f'loading {a.model} (the first run downloads about 3.1 GB)', flush=True)
    try: m = load_model(get_model_path(os.path.expanduser(a.model)))
    except Exception as e: sys.exit(f'tts_qwen.py: could not load {a.model}: {str(e)[:300]}')
    if not hasattr(m, '_prepare_batch_inputs') or not getattr(m, 'supported_speakers', None):
        sys.exit(f'tts_qwen.py: {a.model} is not a Qwen3-TTS CustomVoice model (it has no built-in voices)')
    avail = [s.lower() for s in m.supported_speakers]
    bad = sorted({L['_voice'] for L in lines if L['_voice'] not in avail})
    if bad: sys.exit(f"tts_qwen.py: unknown voice(s) {', '.join(bad)}.\n  available: {', '.join(avail)}")
    qwen_batch.lean(m)
    if a.seed is not None: mx.random.seed(a.seed)
    print(f'model ready in {time.time() - t0:.1f}s', flush=True)

    checker = None
    if not a.no_check and any(L['_lang'] == 'english' for L in lines):
        try:
            from take_check import TakeCheck
            checker = TakeCheck(a.check_model)
        except Exception as e:
            print(f'warning: the Whisper check could not start ({str(e)[:200]}); only the cut check runs', file=sys.stderr, flush=True)

    def gen(todo):
        out = {}
        for lang in sorted({L['_lang'] for L in todo}):              # one language per batch, similar lengths together
            grp = sorted([L for L in todo if L['_lang'] == lang], key=lambda L: len(spoken(L)))
            for i in range(0, len(grp), a.batch):
                b = grp[i:i + a.batch]
                xs = qwen_batch.generate_batch(m, [spoken(L) for L in b], voice=[L['_voice'] for L in b],
                                               instruct=[L['_ins'] for L in b], lang=lang, eos_hold=1)
                for L, x in zip(b, xs): out[L['id']] = fade_end(trim(x))
        return out

    def check(L, x):
        """(passed, score, note)"""
        if clipped(x): return False, 0.0, 'cut end'
        if checker is None or L['_lang'] != 'english': return True, 1.0, ''
        r = checker(x, SR, expected(L))
        return r['passed'], r['acc'], '' if r['passed'] else 'missed ' + ' '.join(r['missed'][:4]) + f" (heard: {r['heard'][:80]})"

    best = {}; todo = lines; redone = 0
    for rnd in range(a.retries + 1):
        takes = gen(todo)
        for L in todo:
            ok, sc, note = check(L, takes[L['id']]); old = best.get(L['id'])
            if old is None or (ok, sc) > (old[1], old[2]): best[L['id']] = (takes[L['id']], ok, sc, note)
        todo = [L for L in todo if not best[L['id']][1]]
        if not todo: break
        if rnd < a.retries:
            redone += len(todo)
            print(f"redo {len(todo)}: " + ', '.join(f"{L['id']} ({best[L['id']][3]})" for L in todo[:6]) + (' ...' if len(todo) > 6 else ''), flush=True)

    os.makedirs(a.out, exist_ok=True); dur = {}
    for L in lines:
        x, ok, sc, note = best[L['id']]
        sf.write(os.path.join(a.out, L['id'] + '.wav'), x, SR); dur[L['id']] = round(len(x) / SR, 3)
        print(L['id'], dur[L['id']], L['text'])
    json.dump(dur, open(os.path.join(a.out, 'dur.json'), 'w', encoding='utf-8'), indent=1)
    failing = [(i, v[3]) for i, v in best.items() if not v[1]]
    for i, note in failing: print(f'STILL FAILING after {a.retries} redos: {i} ({note}), kept the best try', file=sys.stderr)
    print(f'guard: {redone} takes redone, {len(failing)} still failing. {len(lines)} lines in {time.time() - t0:.0f}s, '
          f'peak {mx.get_peak_memory() / 1e9:.1f} GB', flush=True)


if __name__ == '__main__':
    if len(sys.argv) < 3 and not (len(sys.argv) == 2 and sys.argv[1] in ('-h', '--help')):
        print(__doc__); sys.exit(2)
    main()
