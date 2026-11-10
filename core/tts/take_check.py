"""Whisper check of one English take, for the redo guard in core/tts/tts_qwen.py.

A take passes when:
 - every number word in the line is heard,
 - the last word is heard (the end isn't cut),
 - word accuracy is at least 0.85,
 - no number is rushed: Whisper's word times give how long a spoken number took, and more than 12.5 syllables
   a second means it was swallowed ("1947" said in 0.44 s). Good takes reach 10.9.
Whisper's written forms are read back as words before comparing: 1947 (cardinal or year, whichever the line uses),
19th, $5 million, $1.50, 10%, 3.5, 9:30, 10pm, 1990s, '90s, and Roman numerals in capitals (GTA VI).

  from take_check import TakeCheck
  check = TakeCheck()                       # faster-whisper small.en on the CPU, int8, 2 threads
  r = check(audio, 24000, "In nineteen forty-seven.")
  r = {"passed": bool, "acc": float, "missed": [...], "heard": str}
"""
import os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from num_words import card, year, ordinal, num, plural, money, clock, AMPM, TENS

NUM = set('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen '
          'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion first second third fourth fifth '
          'sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth '
          'twentieth thirtieth oh'.split())
SYL = dict(zero=2, seven=2, eleven=3, thirteen=2, fourteen=2, fifteen=2, sixteen=2, seventeen=3, eighteen=2, nineteen=2, twenty=2,
           thirty=2, forty=2, fifty=2, sixty=2, seventy=3, eighty=2, ninety=2, hundred=2, thousand=2, million=2, billion=2,
           trillion=2, second=2, seventh=2, eleventh=3, twentieth=3, thirtieth=3, percent=2, dollars=2, point=1)
MAX_SYL = 12.5      # syllables a second, by Whisper word times
MIN_ACC = 0.85


def _split(s): return s.replace('-', ' ').split()


def norm_tokens(s):
    """Lowercase, hyphens to spaces, no punctuation. Digits are kept as tokens."""
    s = s.lower().replace('’', "'")
    s = re.sub(r'[-‐-―/]', ' ', s)
    s = re.sub(r'(\d)[,:](\d)', r'\1\2', s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return ['hmm' if re.fullmatch(r'h*m+h*m*', w) and 'm' in w else w for w in s.split()]


def expand_options(tok):
    """Every word reading of a token: numbers as a cardinal, and from 100 to 9999 as a year too."""
    if not tok.isdigit(): return [[tok]]
    n = int(tok); opts = [_split(card(n))]
    if 100 <= n < 10000:
        y = _split(year(n))
        if y not in opts: opts.append(y)
    return opts


def align(ref, hyp):
    """Levenshtein word alignment. Returns ops (op, i, j) with op in eq/sub/del/ins."""
    n, m = len(ref), len(hyp)
    D = np.zeros((n + 1, m + 1), dtype=np.int32); D[:, 0] = np.arange(n + 1); D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]), D[i - 1, j] + 1, D[i, j - 1] + 1)
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i, j] == D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(('eq' if ref[i - 1] == hyp[j - 1] else 'sub', i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and D[i, j] == D[i - 1, j] + 1:
            ops.append(('del', i - 1, None)); i -= 1
        else:
            ops.append(('ins', None, j - 1)); j -= 1
    return ops[::-1]


def spoken(s):
    """Whisper's written forms back to words: 19th -> nineteenth, $5 million -> five million dollars, 10% -> 10 percent."""
    s = re.sub(r'\$\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)?', lambda m: money(m.group(1), m.group(2)), s)   # same words as num_words
    s = re.sub(AMPM, lambda m: clock(*m.groups()), s)                                         # 10 p.m., 7.30pm
    s = re.sub(r'(\d+)(st|nd|rd|th)\b', lambda m: ordinal(int(m.group(1))), s)
    s = re.sub(r'\b\d+\.\d+\b', lambda m: num(m.group(0)), s)                                 # 3.5 -> three point five
    s = re.sub(r'\b(1[1-9]|20)(\d0)s\b', lambda m: (lambda w: w[0] + ' ' + plural(w[1]))(year(int(m.group(1) + m.group(2))).rsplit(' ', 1)), s)
    s = re.sub(r"'(\d)0s\b", lambda m: plural(TENS[int(m.group(1))]), s)                          # 1990s, '90s
    R = dict(II=2, III=3, IV=4, V=5, VI=6, VII=7, VIII=8, IX=9, X=10, XI=11, XII=12)       # "GTA VI" -> 6 (capitals only, never I)
    s = re.sub(r'\b(' + '|'.join(sorted(R, key=len, reverse=True)) + r')\b', lambda m: str(R[m.group(1)]), s)
    return s.replace('%', ' percent')


def _run_in(o, ref):
    n = len(o); return any(ref[i:i + n] == o for i in range(len(ref) - n + 1))


def words(s, ref=None):
    """Tokens as words. With ref (the line's words, in order), a number Whisper wrote in digits takes the reading
    (cardinal or year) that appears as a run of words in the line, so "by 1999" next to "1,200 copies" is read as a year."""
    out = []; rs = set(ref or ())
    for t in norm_tokens(spoken(s)):
        opts = expand_options(t)
        if ref is not None and len(opts) > 1:
            opts.sort(key=lambda o: (not _run_in(o, ref), sum(w not in rs for w in o), len(o)))
        out += opts[0]
    return out


def syl(w):
    if w in SYL: return SYL[w]
    if w.endswith('teenth'): return 2
    return max(1, len(re.findall(r'[aeiouy]+', w)) - (1 if w.endswith('e') and not w.endswith('ee') else 0))


def rushed(ws, ref):
    """Runs of Whisper words that are numbers in the line, spoken faster than MAX_SYL syllables a second."""
    refset = set(ref); out = []; run = []

    def close():
        if run:
            n = sum(syl(t) for w in run for t in words(w.word, ref)); d = run[-1].end - run[0].start
            if n >= 3 and d > 0 and n / d > MAX_SYL: out.append(f"(rushed {''.join(w.word for w in run).strip()} {d:.2f}s)")
        run.clear()
    for w in ws:
        toks = words(w.word, ref)
        if toks and all(t in NUM and t in refset for t in toks): run.append(w)
        else: close()
    close()
    return out


class TakeCheck:
    def __init__(self, model='small.en', threads=2):
        from faster_whisper import WhisperModel
        self.m = WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=threads)

    def __call__(self, x, sr, text):
        from scipy.signal import resample_poly
        x = resample_poly(np.asarray(x, np.float32), 16000, sr).astype(np.float32)
        segs = list(self.m.transcribe(x, language='en', beam_size=5, condition_on_previous_text=False, word_timestamps=True)[0])
        heard = ''.join(s.text for s in segs).strip()
        ref = words(text); hyp = words(heard, ref)
        joins = {ref[i] + ref[i + 1]: [ref[i], ref[i + 1]] for i in range(len(ref) - 1)}    # Whisper "firestick" = "fire stick"
        hyp = [w for t in hyp for w in joins.get(t, [t])]
        rs = set(ref); merged = []                                                          # and "log book" = "logbook"
        for w in hyp:
            if merged and merged[-1] + w in rs and not (merged[-1] in rs and w in rs): merged[-1] += w
            else: merged.append(w)
        hyp = merged
        ok = set(i for op, i, _ in align(ref, hyp) if op == 'eq')
        missed = [ref[i] for i in range(len(ref)) if i not in ok]
        nums_ok = all(i in ok for i, w in enumerate(ref) if w in NUM)
        last_ok = bool(ref) and (len(ref) - 1) in ok
        acc = len(ok) / max(len(ref), 1)
        fast = rushed([w for s in segs for w in (s.words or [])], ref)
        return dict(passed=bool(nums_ok and last_ok and acc >= MIN_ACC and not fast), acc=round(acc, 3), missed=missed + fast, heard=heard)
