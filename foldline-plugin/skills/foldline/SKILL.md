---
name: foldline
description: Make a short film, explainer or animation drawn entirely in code and render it to MP4 with Foldline, which offers an HTML page with a canvas and render(t), 66 ready film styles, review stills, reading-time checks, offline voice and loudness mastering. Use when the user wants a video made in code (no AI video model), wants to turn a Canvas 2D, WebGL or three.js animation into an MP4, or names a Foldline or lemo-opuscar style. Fastest on a Mac with Apple Silicon.
---

# Foldline

Foldline (https://github.com/alireza12t/foldline) renders a web page that draws a film in code to an H.264 MP4. On a Mac it encodes inside headless Chrome on the hardware encoder.

It's free for non-commercial use (PolyForm Noncommercial 1.0.0). Paid work, like client videos or a monetised channel, needs a commercial licence from the author. If the user mentions paid work, tell them, and point them to the repository's issues ("Commercial licence" in the title).

## 1. Use the Foldline tools when they're there

If you have tools named `find_styles`, `get_style`, `read_guide`, `render_stills`, `render_video`, `check_reading`, `make_voice`, `check_voice`, `mux_audio` and `fetch_assets`, that's the Foldline MCP server. Use those tools, skip step 2, and follow step 3 with them. They return short results.

## 2. Otherwise, get the library

It needs Node 20+ and ffmpeg. It's built and tested on macOS; Windows and Linux are untested and render slower. Tell the user if something is missing instead of installing system software yourself.

```sh
LIB="${FOLDLINE_HOME:-$HOME/foldline}"
if [ -d "$LIB/.git" ]; then git -C "$LIB" pull --ff-only; else git clone --depth 1 https://github.com/alireza12t/foldline "$LIB"; fi
cd "$LIB" && npm ci && npx playwright-core@1.63.0 install chromium-headless-shell
```

Run every tool from `$LIB`, with the film's absolute path. Voice and music need Python 3.11+: from `$LIB`, run `sh plugin/skills/lemo-opuscar/scripts/setup.sh deps voice` (it downloads a voice model of about 350 MB).

## 3. Make the film

1. **Pick a style.** Look it up in `$LIB/styles/README.md`, then read `styles/<slug>/STYLE.md`. The style's look and rules are fixed. The story, shots and timing come from the user's topic.
2. **Read the guides as you need them.** `AGENTS.md` is the workflow. `DIRECTOR.md` covers story, sound, rhythm and checks, and `TECHNIQUE.md` covers building pages, voice, music and the mix. Read one section at a time.
3. **Build in the user's folder, never inside `styles/`.** The page must:
   - set `window.READY = true` once fonts and images are loaded;
   - define `window.render(t)` to draw the frame at second `t`, the same every time;
   - set `window.DUR` to the length in seconds;
   - optionally set `window.EV` (sound cues) and `window.TEXTS(t)` (on-screen text, for the reading check).

   For the fast path, draw the whole film into one visible `<canvas id="c">` of the render size. Library files load from `/core/...` and `/node_modules/...`.
4. **Review stills:** `node core/render/still.mjs "<film>" 2 10 20` writes JPEGs to look at. Fix what's wrong before a full render.
5. **Check text timing:** `node core/render/readcheck.mjs "<film>"`.
6. **Render:** `nice -n 20 node core/render/video.mjs "<film>" --fps 30 --size 1920x1080 --out "<film>/out/video.mp4"`. Use `--size 1080x1920` for a vertical Short. On a Mac the last line should say `enc=wc`.
7. **Sound:** make voice lines with `core/tts/tts.py` (Kokoro, offline), or on a Mac with Apple silicon `core/tts/tts_qwen.py` (Qwen3-TTS, local, an `instruct` per line; install with `setup.sh deps qwen`), build the mix, then master it under the picture with `sh core/render/mux.sh "<film>/out/video.mp4" mix.wav "<film>/out/final.mp4"`.

Tell the user where the final MP4 is. `core/README.md` lists every command and flag.
