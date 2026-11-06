# Notice

Foldline includes [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) by [LemoLab](https://github.com/lemomo-ai). It is based on commit `f171360` of that repository. LemoLab's original README is kept as [LEMO-README.md](LEMO-README.md).

## Code and docs

The code and docs are under the MIT licence. See [LICENSE](LICENSE). It keeps LemoLab's copyright notice next to ours.

## Demo films and stills

The demo films and their stills (in `styles/`, the gallery and the releases) are by LemoLab. They are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit **LemoLab** with a link to [the original repository](https://github.com/lemomo-ai/lemo-opuscar). If you change them, say so.

## What we changed

- `core/render/video.mjs`: in-page WebCodecs hardware H.264 encoding as the default path, VideoToolbox and x264 fallbacks, an `--audio` option, and a check of the output stream.
- The package is renamed to `foldline`.

Everything else is LemoLab's work as published.

## Third-party assets

Third-party assets in the demos keep their own licences. Each demo's `CREDITS` file names them.

## Voice tracks not covered

Three voice tracks are not under CC BY 4.0. They are excluded from the licence above:

- The shouts in Game Show Flat (macOS system voices, `say`).
- The narration in Paper-cut Lightbox (Microsoft Edge TTS).
- The narration in Broadcast News Package (Doubao TTS, under Volcengine's terms).

Don't reuse them. In your own films use Kokoro (the default) or a voice you have the right to use.
