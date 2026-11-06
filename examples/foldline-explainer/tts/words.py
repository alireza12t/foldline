# Word timestamps for every take (faster-whisper small.en) -> voices/words.json {id: [[word, start, end], ...]}; flags takes with missing words.
import json, pathlib, re
from faster_whisper import WhisperModel
HERE = pathlib.Path(__file__).resolve().parent; V = HERE.parent / 'voices'
L = json.load(open(HERE / 'lines.json')); m = WhisperModel('small.en', device='cpu', compute_type='int8')
norm = lambda s: re.sub(r"[^a-z0-9' ]+", ' ', s.lower().replace('-', ' ')).split()
out = {}; bad = []
for l in L:
    segs, _ = m.transcribe(str(V / f"{l['id']}.wav"), word_timestamps=True, language='en')
    ws = [[w.word.strip(), round(w.start, 3), round(w.end, 3)] for s in segs for w in s.words]; out[l['id']] = ws
    heard = norm(' '.join(w[0] for w in ws)); miss = [w for w in norm(l['display']) if w not in heard and not w.isdigit() and len(w) > 3]
    if len(miss) > 2: bad.append((l['id'], miss[:6]))
json.dump(out, open(V / 'words.json', 'w'), indent=0); print('words ok', len(out)); [print('CHECK', b) for b in bad]
