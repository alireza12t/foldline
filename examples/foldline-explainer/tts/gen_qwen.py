#!/usr/bin/env python
"""Render the narration lines with local Qwen3-TTS CustomVoice (MLX 8-bit, Apple Silicon). Voice: "ryan".
Reads tts/lines.json: [{id, voice:[preferred, fallbacks...], text, instruct}].
Writes voices/<id>.wav (silence-trimmed) and updates voices/dur.json.
Needs a Python env with mlx-audio (pip install mlx-audio soundfile numpy). Optional args = only these ids."""
import json, pathlib, sys
import numpy as np, soundfile as sf
from mlx_audio.tts.utils import load_model
from mlx_audio.utils import get_model_path

HERE = pathlib.Path(__file__).resolve().parent
VOICES = HERE.parent / 'voices'
REPO = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'

LINES = json.load(open(HERE / 'lines.json'))
only = set(sys.argv[1:])
if only: LINES = [l for l in LINES if l['id'] in only]

def trim(x, sr, thresh=0.01, head=0.010, tail=0.100):
    a = np.abs(x); peak = a.max() + 1e-9
    idx = np.where(a > peak * thresh)[0]
    if len(idx) == 0: return x
    i0 = max(0, idx[0] - int(head * sr)); i1 = min(len(x), idx[-1] + int(tail * sr))
    return x[i0:i1]

model = load_model(get_model_path(REPO))
VOICES.mkdir(exist_ok=True)
try: dur = json.load(open(VOICES / 'dur.json'))
except FileNotFoundError: dur = {}
for L in LINES:
    vid = L['id']; audio = None; used = None; err = None
    for v in L['voice']:
        try:
            chunks = []; sr = 24000
            for r in model.generate(text=L['text'], voice=v, instruct=L['instruct'], lang_code='english', verbose=False):
                chunks.append(np.array(r.audio, dtype=np.float32).reshape(-1)); sr = r.sample_rate
            audio = np.concatenate(chunks); used = v; break
        except Exception as e:
            err = str(e)[:160]; continue
    if audio is None:
        print(f'FAIL {vid}: {err}'); continue
    audio = trim(audio, sr)
    sf.write(VOICES / f'{vid}.wav', audio, sr)
    dur[vid] = round(len(audio) / sr, 3)
    print(f'{vid} voice={used} {dur[vid]}s', flush=True)
json.dump(dur, open(VOICES / 'dur.json', 'w'), indent=1)
print('DONE')
