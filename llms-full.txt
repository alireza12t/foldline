# Foldline

> Foldline renders HTML canvas animations to H.264 MP4 fast on a Mac. It opens a web page in headless Chrome, calls the page's `render(t)` for every frame, and encodes the video inside the page with WebCodecs on the Mac's hardware encoder, so frames never leave the GPU. It ships the full lemo-opuscar library by LemoLab: 66 film styles made in code, with a Claude Code plugin. Open source and free for non-commercial use (PolyForm Noncommercial 1.0.0; commercial use needs a licence from the author). LemoLab's original lemo-opuscar code stays MIT and its demo films are CC BY 4.0. Repository: https://github.com/alireza12t/foldline

This is the long version of https://github.com/alireza12t/foldline/blob/main/llms.txt, in one file. The README has the same facts: https://github.com/alireza12t/foldline#readme

## What it is

Foldline turns a web page that draws a film in code into an H.264 MP4. You write an HTML page with a `<canvas>` and a `render(t)` function. Foldline opens it in headless Chrome (driven by Playwright), draws every frame, and encodes the video.

Foldline is a project by Alireza Toghiani, built for Unfold, an animated "What if" YouTube channel (https://www.youtube.com/@UnfoldAnimated). It isn't a GitHub fork. It ships the full lemo-opuscar library by LemoLab (https://github.com/lemomo-ai/lemo-opuscar):

- all 66 film styles in `styles/`, each with a style prompt and a demo film made in code
- the toolkit in `core/` (render, voice, music, mix)
- the guides `DIRECTOR.md`, `TECHNIQUE.md` and `MY-STYLES.md`
- lemo's Claude Code plugin in `plugin/`

What Foldline adds is a faster video renderer, `core/render/video.mjs`. Everything else is LemoLab's work as published.

## What's new vs lemo-opuscar

- The page encodes the video itself. By default `video.mjs` encodes H.264 inside the page with WebCodecs (`VideoEncoder`, `hardwareAcceleration: 'prefer-hardware'`), on the Mac's hardware encoder. Each frame goes from the canvas to the encoder on the GPU. No screenshot, no JPEG, no ffmpeg decode.
- It works when the film draws into one visible `<canvas id="c">` of the render size. 35 of the 66 lemo demos do, and Unfold's videos do.
- Automatic fallback. If the page doesn't fit that, or the browser has no hardware H.264 encoder, it falls back to the screenshot path with the Mac hardware encoder (VideoToolbox). If that isn't available either, it uses x264.
- `FOLDLINE_ENC=auto|wc|vt|x264` picks the encoder. `auto` is the default. `x264` is lemo's original path. `LEMO_ENC` still works.
- `FOLDLINE_MBPS` sets the bitrate for the WebCodecs path, in Mbit/s (default 20).
- `--audio <file>` muxes a sound file in (AAC 192k). The picture is never cut to the sound: a soundtrack shorter than the film is padded with silence to the end, and a longer one is cut at the end. Add `--allow-short-audio` when the sound is meant to stop early.
- The finished file is checked before it's saved, not just for which streams it has: every rendered frame must decode (one frame of slack), the picture must run from 0 to the film's length, and the soundtrack must start with it and end with it (or before it, with `--allow-short-audio`). A file that ends early, after a missing chunk or a muxing mistake, fails the render and isn't saved.
- Output is standard bt709 limited-range H.264 mp4.

## Install

Needs macOS on Apple Silicon (recommended; the fast path needs Chrome's hardware H.264 encoder), Node 20+, ffmpeg 7+, and Python 3.11+ for the voice and music tools.

```sh
git clone https://github.com/alireza12t/foldline.git
cd foldline
npm ci
node node_modules/playwright-core/cli.js install chromium-headless-shell
```

To use a different Chrome or headless-shell executable, set `PLAYWRIGHT_CHROME=/path/to/chrome-headless-shell`.

Python tools (sound effects, mix, subtitles, voice): `sh plugin/skills/lemo-opuscar/scripts/setup.sh deps` (core), add `voice` for Kokoro, edge-tts, faster-whisper and the Kokoro model, `music` for numba, or `qwen` for the Qwen3-TTS voice (Mac with Apple silicon: mlx-audio and faster-whisper; the model, about 3.1 GB, downloads on first use).

## Smallest working example

`my-film/index.html`:

```html
<!doctype html>
<html><body style="margin:0">
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const c = document.getElementById('c'), x = c.getContext('2d');
window.DUR = 5;                       // length in seconds
window.render = (t) => {              // draw the frame at t seconds
  x.fillStyle = '#10141c'; x.fillRect(0, 0, 1920, 1080);
  x.fillStyle = '#ffd166';
  x.beginPath(); x.arc(200 + t * 300, 540, 80, 0, Math.PI * 2); x.fill();
};
window.READY = true;                  // fonts and assets are loaded
</script></body></html>
```

Render it from the repo folder:

```sh
node core/render/video.mjs my-film --size 1920x1080 --fps 60 --out my-film/out/video.mp4
```

The renderer prints `enc=wc` when it used the fast in-page WebCodecs path.

## Example film

`examples/foldline-explainer/` is a 96-second, 1920x1080 explainer made with Foldline itself: every frame drawn in code, a local text-to-speech voice, music synthesised in code. It renders in 34 s. The finished MP4 is attached to release v1.0.0: https://github.com/alireza12t/foldline/releases/download/v1.0.0/foldline-explainer.mp4 (release page: https://github.com/alireza12t/foldline/releases/tag/v1.0.0). Source: https://github.com/alireza12t/foldline/tree/main/examples/foldline-explainer Watch it on YouTube: https://youtu.be/VWgjNfQqT7k. A step-by-step deep dive is on Medium: https://medium.com/@devmvrick/part-2-i-made-my-code-drawn-videos-render-up-to-2-6x-faster-on-a-mac-free-open-source-3500fed32b95.

## The page contract

This comes from lemo-opuscar. Each film is a folder with an `index.html` that sets:

```js
window.DUR = 54.2;                 // film length in seconds
window.render = (t) => { ... };    // draw the frame at t seconds; may be async
window.READY = true;               // set once fonts and assets are loaded
```

`render(t)` should draw the same picture for the same `t` (no clocks, no `requestAnimationFrame` timing), because the film is split across parallel workers and each one starts mid-film. For the fast path, draw the whole film into one visible `<canvas id="c">` of the render size, with nothing else visible. Any other page still renders, through the screenshot path.

## Usage

Render a library demo:

```sh
node core/render/video.mjs styles/rubber-hose/demo --fps 24 --out out/rubber-hose.mp4
```

Some demos need `npm ci` or `node fetch_fonts.mjs` in their own folder first.

Render your own page with sound:

```sh
node core/render/video.mjs my-film --size 1080x1920 --fps 60 --audio my-film/mix.wav --out my-film/out/video.mp4
```

Stills for review: `node core/render/still.mjs <dir> 3 20 --out <dir>` writes JPEGs at 3 s and 20 s.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--fps` | 24 | frames per second |
| `--size WxH` | 1920x1080 | render size, even numbers |
| `--workers` | 3 | parallel browsers; up to 6 for a single render |
| `--out` | `<demo>/out/video.mp4` | output file; each parallel render needs its own |
| `--q 'k=v&…'` | none | reaches the page as `location.search` |
| `--audio <file>` | none | mux a sound file in (AAC 192k); new in Foldline |
| `--allow-short-audio` | off | with `--audio`: let a soundtrack shorter than the film end early instead of padding it with silence |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `FOLDLINE_ENC` | `auto` | `auto` (WebCodecs, else VideoToolbox, else x264), `wc`, `vt`, or `x264` (lemo's original path). `LEMO_ENC` still works |
| `FOLDLINE_MBPS` | 20 | bitrate in Mbit/s for the WebCodecs path |
| `LEMO_VTQ` | 72 | quality for the VideoToolbox screenshot path |

## MCP server

`core/mcp/server.mjs` is a stdio MCP server, published on npm as `foldline-mcp` and in the MCP Registry as `io.github.alireza12t/foldline`. Claude Code: `claude plugin install foldline --marketplace alireza12t/foldline`, or `claude mcp add --scope user foldline -- npx -y foldline-mcp`. Codex, Cursor, VS Code and Claude Desktop: command `npx`, args `["-y", "foldline-mcp"]`. Needs Node 20+, ffmpeg and Chrome's headless shell (`npx playwright-core@1.63.0 install chromium-headless-shell`). Inside the repo, `.mcp.json` registers a local copy for Claude Code.

Tools: `find_styles` (search the 66 styles), `get_style` (a style prompt), `read_guide` (table of contents, or one section of AGENTS, DIRECTOR, TECHNIQUE, MY-STYLES, the tool reference and others), `render_stills` (JPEGs, optionally one contact sheet image), `render_video` (full render, returns only the done line), `check_reading` (text timing, failures only), `export_events`, `make_voice` (Kokoro, Edge TTS or Qwen3-TTS), `check_voice` (Whisper), `mux_audio` (-14 LUFS master), `make_subtitles` (.srt), `fetch_assets` (voice model, HDRIs, instruments).

Results are short so agents spend fewer tokens. Renders run under `nice`. Python tools use `FOLDLINE_PYTHON`, then `.venv`, then `~/lemo-opuscar/.venv`.

## Results

Measured on an M1 Pro with 16 GB, nothing else running, Nov 6 2026.

Unfold Short (83 s, 1080x1920, 60 fps, 4-sample motion blur):

- Full build: 60 s before, 29-32 s with Foldline (runs: 29.4, 29.0, 31.8).
- Render: 69-88 s with screenshots + x264, 45 s with screenshots + hardware encoder, 29 s with WebCodecs.
- Peak RAM: 2.2 GB before, 1.3-1.5 GB with Foldline.

Unfold long video (EP9, the full 8.4 min, 1920x1080, 60 fps):

- Render time: 426 s with screenshots + hardware encoder, 161 s with Foldline (runs: 161.8, 161.5; 187 fps).
- CPU time: 943 CPU-seconds before, 134 CPU-seconds with Foldline (-86%).
- Peak RAM: about 1.5 GB both ways.

lemo's Pixel RPG demo (54.5 s, 1920x1080, 24 fps, 3 workers, two runs each):

- lemo original (x264): 20.8 s, 19.8 s. Foldline: 8.1 s, 8.0 s (177 fps). Speed-up 2.5x.
- CPU time 70 to 9 CPU-seconds. Peak RAM 2.85 to 1.1 GB.

Picture quality: frames compared against the original canvas PNGs score 38-39 dB on both the old and the new path (the normal colour conversion to video). Old vs new long video: 42.3 dB on average, lowest frame 39.6 dB. Pixel RPG: 47.7 dB on average between the two outputs, lowest frame 42.1 dB. Identical to the eye.

Where the time goes: drawing a frame takes about 4 ms on the GPU. The ceiling is the Mac's single hardware H.264 encoder, about 165-185 fps at 1080x1920, shared by all workers.

Tried and dropped: rendering without Chrome (Node + Skia on the CPU was 18x slower per frame; skia-canvas on Metal topped out at 30 fps, 3.5x slower); Chrome's software encoder (no faster in real renders, more CPU); mixing hardware and software encoders in one file (too risky for Instagram uploads).

## FAQ

Q: How do I render an HTML canvas animation to MP4?
A: Make a folder with an `index.html` that sets `window.DUR`, `window.render(t)` and `window.READY` (see the page contract). Draw the film into one `<canvas id="c">` of the render size. Then run `node core/render/video.mjs my-film --size 1920x1080 --fps 60 --out my-film.mp4`. Foldline opens the page in headless Chrome, calls `render(t)` for every frame and writes an H.264 MP4.

Q: Is it faster than screenshots + ffmpeg?
A: In our tests, yes. The 8.4-minute Unfold video took 426 s with screenshots and the Mac's hardware encoder, and 161 s with Foldline, with 86% less CPU time. lemo's Pixel RPG demo rendered 2.5x faster than lemo's original screenshots + x264 path.

Q: Why is it faster?
A: The screenshot path copies each frame out of the browser as a JPEG, then ffmpeg decodes it and encodes it again. Foldline hands the canvas straight to Chrome's WebCodecs `VideoEncoder` with hardware acceleration, so the frame stays on the GPU. Drawing a frame takes about 4 ms. The limit now is the Mac's hardware H.264 encoder.

Q: Does it work on Windows or Linux?
A: It's built and tested on a Mac with Apple Silicon. The fast path needs Chrome's hardware H.264 encoder. When Chrome doesn't offer one, Foldline falls back to the screenshot path. VideoToolbox is Mac only, so on other systems that means x264, lemo's original path. It still renders, just not faster. Windows and Linux haven't been tested.

Q: Does my page have to be a single canvas?
A: For the fast path, yes: one visible `<canvas id="c">` of the render size, and nothing else visible. Any other page (DOM elements, SVG, several canvases) still renders, through the screenshot path. 35 of the 66 lemo demos fit the fast path.

Q: Does the video look different?
A: Not to the eye. The old and new long video differ by 42.3 dB on average (lowest frame 39.6 dB). Output is standard bt709 limited-range H.264 mp4.

Q: Can I add sound?
A: Yes. `--audio my-film/mix.wav` muxes the file in as AAC 192k. A shorter mix is padded with silence, never used to cut the picture; pass `--allow-short-audio` if it's meant to end early. Before saving, the renderer decodes the result and refuses it if it's missing a stream, has fewer frames than were rendered, or its sound doesn't line up with the start and end of the film.

Q: What is lemo-opuscar?
A: lemo-opuscar (https://github.com/lemomo-ai/lemo-opuscar) is LemoLab's open library of film styles made in code, for Claude Code. Each of the 66 styles has a style prompt and a demo film drawn entirely in code, with no video model. Foldline includes all of it. Foldline changed the video renderer and added an MCP server.

Q: Can I use it with Claude Code or another coding agent?
A: Yes. lemo's Claude Code plugin is in `plugin/`, and agents that read `AGENTS.md` get the same guide. Start the agent inside the Foldline folder so it uses Foldline's renderer.

Q: Is it free?
A: Yes, for any non-commercial use: personal projects, learning, research and hobby films. The code is public, and you can change and share it. It needs only free tools: Node, ffmpeg and Chrome's headless shell.

Q: Can I use Foldline to make money?
A: Only with a commercial licence. That covers selling Foldline or a service built on it, and paid work made with it, like client videos or monetized channels. Ask by opening an issue at https://github.com/alireza12t/foldline/issues with "Commercial licence" in the title. lemo-opuscar's original code is MIT and free for any use from https://github.com/lemomo-ai/lemo-opuscar.

## How it compares

Foldline is a renderer plus a style library, not a framework or a timeline editor. You write the page, Foldline renders it.

- Foldline: you write an HTML page with `render(t)`. Frames go from the canvas to a WebCodecs hardware H.264 encoder inside the page; fallbacks are VideoToolbox, then x264. PolyForm Noncommercial (free for non-commercial use). 66 ready-made styles from lemo-opuscar.
- lemo-opuscar (original): the same page contract and styles. Frames are taken as screenshots and encoded with x264. MIT.
- Remotion (https://github.com/remotion-dev/remotion): you write React components. Remotion License: free for individuals, non-profits and companies of up to 3 employees; a paid company licence above that.
- Motion Canvas (https://github.com/motion-canvas/motion-canvas): you write TypeScript scenes. MIT.
- HyperFrames (https://github.com/heygen-com/hyperframes): you write HTML. Apache-2.0.

## Credits

- LemoLab / lemo-opuscar (https://github.com/lemomo-ai/lemo-opuscar) by Lemomo (@lemomo_ai on X): the whole style library, the toolkit, the guides, the page contract and the render pipeline Foldline builds on.
- Playwright drives the headless browser. Chromium draws the frames and, through WebCodecs, encodes them. FFmpeg wraps, joins and muxes the video. three.js for the 3D styles. Poly Haven for CC0 HDRIs and models. Kokoro TTS for offline narration. Qwen3-TTS (Apache-2.0) through mlx-audio for the local Qwen voice. Google Fonts for fonts in the demos.

## Licence

- Foldline's code: PolyForm Noncommercial 1.0.0, copyright Alireza Toghiani. Free to use, change and share for any non-commercial purpose. Commercial use needs a licence from the author.
- lemo-opuscar's original code: MIT, copyright LemoLab. NOTICE.md says which parts are which.
- Copies downloaded before November 7, 2026 were MIT and stay MIT.
- Demo films and their stills from lemo-opuscar (in `styles/`): CC BY 4.0. Credit LemoLab with a link to https://github.com/lemomo-ai/lemo-opuscar, and say if you changed them.
- Three voice tracks in the demos are not CC BY 4.0 (Game Show Flat, Paper-cut Lightbox, Broadcast News Package). Don't reuse them.
- Films you make with it: yours. Making them to earn money needs a commercial licence for Foldline.
