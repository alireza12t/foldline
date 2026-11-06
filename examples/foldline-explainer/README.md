# Foldline explainer (example film)

The 96-second explainer at the top of the main README, made entirely with Foldline: every frame is drawn in code on one canvas, the narration is a local text-to-speech voice, and the music is synthesised in code. It's also a working example of a full film.

| File | What it does |
|---|---|
| `index.html`, `film.js` | The film: one `<canvas id="c">` (1920x1080), 12 scenes, word-by-word captions. Follows the page contract (`window.DUR`, `window.render(t)`, `window.READY`). |
| `tts/lines.json` | The script, one entry per line. |
| `tts/gen_qwen.py` | Generates `voices/<id>.wav` and `voices/dur.json` with Qwen3-TTS (MLX, Apple Silicon). |
| `tts/words.py` | Word timings with faster-whisper into `voices/words.json` (the captions and word-synced moments use them). |
| `voices/dur.json`, `voices/words.json` | The timings of the published film, so the page runs without generating the voice. |
| `mix.py` | The score (synthesised, no samples), soft scene clicks, ducking under the voice, loudness to -14 LUFS. |
| `thumb/index.html` | The 1280x720 thumbnail, drawn in code. |

## Rebuild it

From the repo root:

```sh
# 1. voice (optional: the timings are already in voices/)
python examples/foldline-explainer/tts/gen_qwen.py
python examples/foldline-explainer/tts/words.py

# 2. music and mix (needs the wavs from step 1)
python examples/foldline-explainer/mix.py

# 3. picture + sound, on the fast path
node core/render/video.mjs examples/foldline-explainer --fps 60 --workers 3 \
  --audio examples/foldline-explainer/out/mix14.wav \
  --out examples/foldline-explainer/out/foldline-explainer.mp4

# stills and the thumbnail
node core/render/still.mjs examples/foldline-explainer 10 45 --out /tmp/stills
node core/render/still.mjs examples/foldline-explainer/thumb 0 --size 1280x720 --out /tmp/thumb
```

On an M1 Pro the render takes about 34 s for the 96 s film (5,774 frames at 60 fps, 175 fps, `enc=wc`).
