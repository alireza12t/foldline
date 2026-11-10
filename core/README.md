# core/: the shared production tools

Command reference for `core/` and `tools/`. How the pieces fit together is in [`TECHNIQUE.md`](../TECHNIQUE.md). Run commands from the library root (`$LIB` in skill mode); Python is the library's `.venv/bin/python`. `<demo>` is any folder with an `index.html`.

## Install

| Command | What it does |
|---|---|
| `sh plugin/skills/lemo-opuscar/scripts/setup.sh` | find, clone or update the library; prints `LIB=<path>` |
| `… setup.sh deps` | core tier: npm packages, headless browser, `.venv` from `requirements.txt` |
| `… setup.sh deps voice` | adds `requirements-voice.txt` (kokoro-onnx, edge-tts, faster-whisper) and the Kokoro model |
| `… setup.sh deps music` | adds `requirements-music.txt` (numba, for `pluck.py`; `sampler.py` needs only the core) |
| `… setup.sh deps qwen` | adds `requirements-qwen.txt` (mlx-audio, faster-whisper) for `tts_qwen.py`; Mac with Apple silicon. The model downloads on first use |
| `… setup.sh demo <slug>` | adds one style's demo source and poster (to read, not to render) |
| `sh tools/fetch.sh voice` \| `hdri` \| `instruments <lib>` \| `instruments all` | Kokoro model · HDRIs · a sample library (`freepats`, `karoryfer`, `salamander`, `vcsl`, `vsco2ce`) |

Sizes are in TECHNIQUE.md §1.

## The page contract

| Global | Required | Meaning |
|---|---|---|
| `window.READY = true` | yes | set once fonts and images are loaded |
| `window.render(t)` | yes | draw the frame at second `t`; deterministic |
| `window.DUR` | video, events, readcheck | film length in seconds |
| `window.EV = [{t, type, …}]` | no | sound and cue events, exported by `events.mjs` |
| `window.TEXTS(t)` | readcheck | `[{id, text, x0, y0, x1, y1}]`: every on-screen text visible at `t`, with its box in pixels. Report an element's **full** text from its first visible frame (a typewriter that reports only the typed letters fails the check) |

The viewport is 1920×1080 at device scale 1, or `--size WxH`. `--q 'k=v&…'` reaches the page as `location.search`. A page error, or an HTTP error on a script, module or the page, stops the tool (exit 1). Other missing files (fetch, images, fonts) print `optional file missing: <URL>` and the tool carries on. The tools wait up to 180 s for `window.READY`.

## Render

| Command | What it does |
|---|---|
| `node core/render/still.mjs <demo> <t> [<t> …] [--range a:b:step] [--prefix t_] [--out dir]` | review stills as JPEGs (default `<demo>/stills/t_<t>.jpg`) |
| `node core/render/video.mjs <demo> [--fps 24] [--workers 3] [--out <demo>/out/video.mp4] [--audio mix.wav [--allow-short-audio]]` | every frame to a video; up to 6 workers for a single render. Each parallel version needs its own `--out`. The finished file is checked before it's saved (below) |
| `node core/render/output.mjs check <file.mp4> --fps 24 (--frames N \| --duration S) [--audio full\|short\|none]` | the finished-file check on its own (below) |
| `node core/render/events.mjs <demo> [--out <file>]` | export `{dur, ev}` to `<demo>/events.json` |
| `node core/render/readcheck.mjs <demo> [--step 0.04] [--latin-cps 15] [--cjk-cps 4.5] [--pad 1.5] [--min 1.5]` | reading-time check (below) |
| `.venv/bin/python core/render/sheet.py out.jpg img… [--cols 4] [--w 480]` | contact sheet |
| `.venv/bin/python core/render/srt.py cues.json out.srt` | subtitles from `[{t0, t1, text}]` |
| `sh core/render/mux.sh video.mp4 mix.wav out.mp4 [fps=24] [grain=2]` | mux and master (below) |

All four page tools take `--size WxH` (default `1920x1080`, even numbers) and `--q 'k=v'`.

**readcheck** asks the page for `window.TEXTS(t)` at every step. Each text must stay fully in frame, unchanged, for at least CJK characters ÷ 4.5 + other non-space characters ÷ 15 + 1.5 s, and never less than `--min`. A new `text` under the same `id` starts a new piece. Subtitles are checked by their `.srt`, not here.

**mux** runs a two-pass `loudnorm` to −14 LUFS / true peak −1.2 dB, adds film grain (`grain` 0 = none) and prints the measured loudness. Silent audio is left at its level with a warning; short audio is padded, long audio cut at the picture's end; missing, damaged or truncated audio is refused. It never leaves a partial file, and it checks the written film the same way as the renderer (below).

**The finished-file check** (`output.mjs`, run by `video.mjs` and `mux.sh` before they hand a file over) doesn't stop at which streams exist. A file can hold a video and an audio stream and still end early. So it decodes the picture and counts its frames against what was rendered (one frame of slack), checks that the picture runs from 0 to the film's length, and that the soundtrack starts with the picture and ends with it. A soundtrack is never allowed to cut the picture (no `-shortest`): one that's shorter is padded with silence, unless `video.mjs` got `--allow-short-audio` (MCP: `allow_short_audio`), which lets it end early but never late. A file that fails isn't saved. Decoding takes about 2 s per minute of 1080p. Tests: `npm test`.

## Audio

| Command | What it does |
|---|---|
| `.venv/bin/python core/tts/tts.py lines.json out_dir` | Kokoro, offline. `lines.json` = `[{id, text, voice?, speed?, lang?}]` (defaults `af_bella`, `0.92`, `en-us`; Chinese: `"lang": "cmn"`, a `zf_*`/`zm_*` voice). Writes `<id>.wav` (24 kHz, trimmed) and `dur.json`. Needs a library path under 160 bytes (espeak-ng); it checks |
| `.venv/bin/python core/tts/tts_zh.py lines.json out_dir [--voice zh-CN-XiaoxiaoNeural] [--rate +0%] [--pitch +0Hz]` | edge-tts (Microsoft), online; same outputs as `tts.py`. Per line: `voice`, `rate`, `pitch`, `say` (what is spoken when it differs from `text`). Caches in `out_dir/.cache/`. Voices: `.venv/bin/python -m edge_tts --list-voices` |
| `.venv/bin/python core/tts/tts_qwen.py lines.json out_dir [--voice ryan] [--instruct "…"] [--batch 16] [--retries 3] [--no-check] [--seed N]` | [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) on MLX: local, free, Mac with Apple silicon; same outputs as `tts.py` (each take also gets a 10 ms fade at the end). Per line: `voice` (`ryan`, `aiden` for English; `vivian`, `serena`, `uncle_fu`, `dylan`, `eric` Chinese; `ono_anna` Japanese; `sohee` Korean), `instruct` (how to say it, in plain words), `lang` (`english` by default, or `chinese`, `japanese`, `korean`, `german`, `french`, `russian`, `portuguese`, `spanish`, `italian`), `say`, `asr`. English digits are spelled as words first. Every take is checked for a cut end and, in English, by Whisper (numbers, last word, accuracy ≥ 0.85, no rushed number); failing takes are redone up to `--retries` rounds, and a line that still fails keeps its best try and is printed as `STILL FAILING`. The model (`--model`, default `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`, about 3.1 GB) downloads on first use; peak memory about 4.5 GB at batch 16 |
| `.venv/bin/python core/tts/asr_check.py lines.json voices_dir [--lang en\|zh\|auto] [--threshold 0.92] [--model base]` | speech-to-text check of every `<id>.wav`; writes `words.json` (word timestamps). English must match word for word (0–999 count the same as their words); Chinese, Japanese, Korean compare by character similarity ≥ `--threshold`, each number by its value (十九 = 19, 一万九千 = 1.9万, 三点五 = 3.5, 百分之三十 = 30%); a number heard as a different number fails the line. An `asr` field in a line overrides the expected text (names, and in English decimals and times: write it as Whisper does) |
| `core/audio/sfx.py` | procedural foley and mix helpers: filters, envelopes, `click`, `whoosh`, `thump`, `ding`…, `compress`, `limit`, `add(buf, sound, at, gain, pan)` |
| `core/audio/sampler.py`, `core/audio/pluck.py` | sampled instruments and plucked-string modelling ([`audio/INSTRUMENTS.md`](audio/INSTRUMENTS.md)). A missing library is named in the error with its `fetch.sh instruments <lib>` command. `credits(names)` writes the CREDITS lines |

## Picture helpers

| File | What it is |
|---|---|
| `core/lib.js` | seeded random `mulberry`, `hash`, `vnoise`, `clamp(x,a,b)`, `lerp(a,b,t)`, `seg(t,a,b)` (0→1 between a and b), easing on 0–1 (`ss(t)`, `eio(t)`, `eo(t)`, `ei(t)`, `back(t,s)`, `spring(t,k,z)`), `monotone`/`track` interpolation, envelope `env` |
| `core/three/post.js` | three.js post: physical depth of field, GTAO, bloom, colour grade, 2× supersampling |
| `core/post/crt.js` | WebGL2 CRT / VHS pass over a 2D canvas |
| `core/fonts/` | Fredoka, Lilita One, IM Fell English, ZCOOL KuaiLe (OFL, [`fonts/OFL.md`](fonts/OFL.md)) as subsets; ZCOOL holds only ≈ 200 characters |
| `core/assets/polyhaven/` | CC0 HDRIs and models (`SOURCES.md`) |

## Environment variables

| Variable | Meaning |
|---|---|
| `LEMO_OPUSCAR_HOME` | where `setup.sh` keeps the library (default `~/lemo-opuscar`) |
| `PLAYWRIGHT_CHROME` | a Chrome / headless-shell executable instead of Playwright's |
| `LEMO_ANGLE` | WebGL backend (default `metal` on macOS; `default` passes none) |
| `RENDER_SLOTS` | optional; limits concurrent full renders across processes |
| `LEMO_COLOR=bt709` | `mux.sh` writes limited-range BT.709 instead of the default full-range output |
| `WHISPER_MODEL` | Whisper model name or local folder for `asr_check.py` (same as `--model`; default `base.en` for English, `small` for Chinese, `base` otherwise) |
| `HF_ENDPOINT` | Hugging Face mirror for the Whisper download |

## Exit codes

| Tool | 0 | 1 | 2 |
|---|---|---|---|
| render tools | done | page error, missing required file, ffmpeg failure | usage, no `index.html`, `--out` already being written |
| `readcheck.mjs` | all texts long enough | some too short or never fully visible | could not check (no `TEXTS`) |
| `mux.sh` | film written | any failure | – |
| `tts.py`, `srt.py` | done | bad input, missing model, path too long | usage |
| `tts_zh.py` | done | bad input | network unreachable |
| `tts_qwen.py` | done (lines still failing the check are printed as `STILL FAILING`) | bad input, not Apple silicon, package or model missing | usage |
| `asr_check.py` | all lines pass | mismatches | model failed to load |
