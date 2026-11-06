# Score + mix for the Foldline explainer. Everything is synthesised here (no samples), so the music is original and free to publish.
#   python mix.py   ->  out/mix.wav (48 kHz stereo), then ffmpeg loudnorm to -14 LUFS -> out/mix14.wav
# Line timing uses the same formula as film.js: start[l01] = 0.8, start[next] = start[prev] + dur[prev] + 0.4, DUR = last start + dur + 3.0.
import json, pathlib, subprocess, sys
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from core.audio.sfx import click, pop, ding, SR, limit   # lemo's procedural SFX (48 kHz)

IDS = [f'l{i:02d}' for i in range(1, 13)]
dur = json.load(open(HERE / 'voices/dur.json'))
start, t = {}, 0.8
for i in IDS: start[i] = t; t += dur[i] + 0.4
DUR = start['l12'] + dur['l12'] + 3.0
N = int(DUR * SR)
music = np.zeros((N, 2)); voice = np.zeros(N); fx = np.zeros((N, 2))

def put(buf, x, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= len(buf): return
    x = x[: len(buf) - i] * gain
    if buf.ndim == 1: buf[i:i + len(x)] += x; return
    buf[i:i + len(x), 0] += x * np.sqrt((1 - pan) / 2) * 1.414; buf[i:i + len(x), 1] += x * np.sqrt((1 + pan) / 2) * 1.414

lp = lambda x, f: sosfilt(butter(2, f, 'low', fs=SR, output='sos'), x)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
tt = lambda d: np.arange(int(d * SR)) / SR

def pluck(m, d=0.9, v=1.0):   # bell-ish electric piano: a few harmonics, fast decay on the upper ones
    x = tt(d); f = hz(m); out = np.zeros_like(x)
    for k, a, tau in [(1, 1, .55), (2, .45, .25), (3, .18, .12), (4.2, .08, .06)]: out += a * np.sin(2 * np.pi * f * k * x) * np.exp(-x / tau)
    return out * np.minimum(1, x / .004) * v

def pad(ms, d, v=1.0):   # soft detuned chord, slow attack and release
    x = tt(d); out = np.zeros_like(x)
    for m in ms:
        for det in (-.07, .07):
            f = hz(m + det); out += np.sin(2 * np.pi * f * x) + .25 * np.sin(4 * np.pi * f * x) + .1 * np.sin(6 * np.pi * f * x)
    env = np.minimum(1, x / .6) * np.minimum(1, (d - x) / .8)
    return lp(out * env, 1800) * v / len(ms)

def bass(m, d=.5, v=1.0):
    x = tt(d); return np.sin(2 * np.pi * hz(m) * x) * np.exp(-x / .35) * np.minimum(1, x / .01) * v

def kick(v=1.0):
    x = tt(.32); f = 50 + 70 * np.exp(-x / .04); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x / .12) * v

BEAT = 60 / 100; BAR = 4 * BEAT
CHORDS = [(53, [65, 69, 72, 76]), (55, [67, 71, 74, 76]), (52, [64, 67, 71, 74]), (57, [64, 69, 72, 76])]   # Fmaj7, G6, Em7, Am7
fast = (start['l05'] - .4, start['l08'] - .4)     # the speed scenes get a kick
end_music = DUR - 3.2
b = 0; tb = 0.0
while tb < end_music:
    root, ch = CHORDS[(b // 2) % 4]
    if b % 2 == 0: put(music, pad(ch, 2 * BAR + .8, .9), tb, .22)
    for k in range(8):   # 8th-note arpeggio, up an octave, gently panned
        at = tb + k * BEAT / 2
        if at >= end_music: break
        put(music, pluck(ch[[0, 1, 2, 3, 2, 1, 2, 3][k]] + 12, .9, .55 if k % 2 else .75), at, .16, pan=[-.35, .35][k % 2])
    for k in (0, 2):
        put(music, bass(root - 12, .55), tb + k * BEAT, .5)
        if fast[0] <= tb + k * BEAT < fast[1]: put(music, kick(), tb + k * BEAT, .55)
    b += 1; tb += BAR
put(music, pad([53, 65, 69, 72, 76], 3.6, 1.0), end_music, .25)        # final Fmaj7 rings out
put(music, pluck(77, 2.5), end_music, .2)

for i in IDS:   # voice
    v, sr = sf.read(HERE / f'voices/{i}.wav', dtype='float32')
    if v.ndim > 1: v = v.mean(1)
    if sr != SR: v = resample_poly(v, SR, sr).astype('float32')
    put(voice, v, start[i])

for k, i in enumerate(IDS):   # soft scene-change clicks (no noise beds, no swishes)
    put(fx, pop(.6) if k % 2 else click(1.2, .6), max(0, start[i] - .38), .18, pan=[-.2, .2][k % 2])
put(fx, ding(.7), start['l12'] + .2, .22)

# duck music under the voice: smoothed voice envelope, about 10 dB below the voice while talking
env = np.abs(voice); w = int(.12 * SR); env = np.convolve(env, np.ones(w) / w, 'same'); env = np.clip(env / (env.max() + 1e-9) * 4, 0, 1)
duck = 1 - .45 * env
vrms = np.sqrt(np.mean(voice[np.abs(voice) > .01] ** 2)); mrms = np.sqrt(np.mean(music[music[:, 0] != 0] ** 2))
music *= (vrms / (mrms + 1e-9)) * 10 ** (-10 / 20)
out = music * duck[:, None] + np.stack([voice, voice], 1) + fx
fade = np.ones(N); nf = int(1.2 * SR); fade[-nf:] = np.linspace(1, 0, nf); out *= fade[:, None]
out = np.stack([limit(out[:, 0], .95), limit(out[:, 1], .95)], 1)
(HERE / 'out').mkdir(exist_ok=True); sf.write(HERE / 'out/mix.wav', out.astype('float32'), SR)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(HERE / 'out/mix.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', str(HERE / 'out/mix14.wav')], check=True)
print(f'DUR {DUR:.2f} s, mix -> out/mix14.wav')
