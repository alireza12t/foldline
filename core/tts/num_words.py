"""Digits to spoken English words, before the text goes to Qwen3-TTS (core/tts/tts_qwen.py).
Qwen reads digits one token at a time and has to guess the reading, so years come out rushed,
swallowed or wrong ("In 1947." was read as "1967"). Words fix that at the source.
Pure Python, no packages, so any venv can import it.

  from num_words import spell
  spell("In 1947.")            -> "In nineteen forty-seven."
  spell("$5 million, 10%")     -> "five million dollars, ten percent"
  python3 core/tts/num_words.py "text"  (prints the spelled text)

Years: a 4-digit 1100-2099 is read as a year (nineteen forty-seven, two thousand five, twenty twenty-two)
unless a count noun follows ("2000 people" -> two thousand people). Also 1990s, '90s, 19th, 9:30, 1939-1945."""
import re, sys

ONES = ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen '
        'seventeen eighteen nineteen').split()
TENS = 'x x twenty thirty forty fifty sixty seventy eighty ninety'.split()
SCALES = [(10 ** 12, 'trillion'), (10 ** 9, 'billion'), (10 ** 6, 'million'), (1000, 'thousand')]
COUNT = re.compile(r'\s+(people|men|women|kids|children|soldiers|troops|dollars|euros|pounds|miles|km|kilometers|meters|feet|'
                   r'kg|tons|years|days|hours|minutes|seconds|times|cars|ships|planes|homes|houses|deaths|lives|votes|'
                   r'copies|units|games|players|fans|views|calories|degrees|horsepower|hp|mph|bucks|of)\b', re.I)


def card(n):
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ('-' + ONES[n % 10] if n % 10 else '')
    if n < 1000: return ONES[n // 100] + ' hundred' + (' ' + card(n % 100) if n % 100 else '')
    for v, w in SCALES:
        if n >= v: return card(n // v) + ' ' + w + (' ' + card(n % v) if n % v else '')


def year(n):
    if 2000 <= n <= 2009: return 'two thousand' + (' ' + card(n % 100) if n % 100 else '')
    hi, lo = divmod(n, 100)
    if lo == 0: return card(hi) + ' hundred'
    return card(hi) + (' oh ' if lo < 10 else ' ') + card(lo)


def ordinal(n):
    w = card(n); head, last = (w.rsplit(' ', 1) + [''])[:2] if ' ' in w else ('', w)
    sub = re.split(r'(-)', last); end = sub[-1]
    end = dict(one='first', two='second', three='third', five='fifth', eight='eighth', nine='ninth', twelve='twelfth').get(
        end, end[:-1] + 'ieth' if end.endswith('y') else end + 'th')
    last = ''.join(sub[:-1]) + end
    return (head + ' ' + last).strip()


def plural(w): return w[:-1] + 'ies' if w.endswith('y') else w + 's'


def num(s):
    s = s.replace(',', '')
    if '.' in s:
        a, b = s.split('.', 1); return card(int(a or 0)) + ' point ' + ' '.join(ONES[int(d)] for d in b)
    return card(int(s))


def spell(t):
    N = r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?'
    t = re.sub(r'\b(\d{4})\s?[-–—]\s?(\d{4})\b', r'\1 to \2', t)                       # 1939-1945
    t = re.sub(r'\$\s?(' + N + r')(?:\s*(thousand|million|billion|trillion))?\b',
               lambda m: num(m.group(1)) + (' ' + m.group(2) if m.group(2) else '') +
               (' dollar' if m.group(1) == '1' and not m.group(2) else ' dollars'), t)
    t = re.sub(r'(' + N + r')\s?%', lambda m: num(m.group(1)) + ' percent', t)
    t = re.sub(r"'(\d)0s\b", lambda m: plural(TENS[int(m.group(1))]), t)                          # '90s
    t = re.sub(r'\b(1[1-9]|20)(\d0)s\b', lambda m: (lambda w: w.rsplit(' ', 1)[0] + ' ' + plural(w.rsplit(' ', 1)[1]))(
        year(int(m.group(1) + m.group(2)))), t)                                                     # 1990s
    t = re.sub(r'\b(\d+)(st|nd|rd|th)\b', lambda m: ordinal(int(m.group(1))), t)                 # 19th
    t = re.sub(r'\b(\d{1,2}):(\d{2})\b', lambda m: card(int(m.group(1))) + (
        " o'clock" if m.group(2) == '00' else (' oh ' if m.group(2)[0] == '0' else ' ') + card(int(m.group(2)))), t)

    def plain(m):
        s = m.group(0); v = s.replace(',', '')
        if re.fullmatch(r'\d{4}', s) and 1100 <= int(v) <= 2099 and not COUNT.match(t, m.end()):
            return year(int(v))
        return num(s)
    return re.sub(r'(?<![\w.])' + N + r'(?![\w])', plain, t)


if __name__ == '__main__':
    print(spell(' '.join(sys.argv[1:])))
