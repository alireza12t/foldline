# Notice

Foldline includes [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) by [LemoLab](https://github.com/lemomo-ai). It is based on commit `f171360` of that repository. LemoLab's original README is kept as [LEMO-README.md](LEMO-README.md).

## Code and docs

Foldline's code is under two licences:

- **Foldline's own work** is under the [PolyForm Noncommercial License 1.0.0](LICENSE). That covers every change and addition made after the import of lemo-opuscar `f171360`: the WebCodecs encoder and the other changes to `core/render/video.mjs`, `examples/`, `docs/`, the README, `llms.txt`, `llms-full.txt`, `tools/sync-pages.sh`, `tools/social-preview/`, the MCP server in `core/mcp/`, `.mcp.json`, `server.json`, the `foldline-plugin/` Claude plugin and the changes to `.claude-plugin/marketplace.json`. Free for any non-commercial use. Making money with it needs a commercial licence: open an issue on this repository with "Commercial licence" in the title.
- **LemoLab's original lemo-opuscar code** stays under the [MIT licence](LICENSE-MIT), with LemoLab's copyright notice. You can use those original parts under MIT, for example from [lemo's own repository](https://github.com/lemomo-ai/lemo-opuscar).

Copies of Foldline downloaded before November 7, 2026 were under the MIT licence and stay under it.

## Demo films and stills

The demo films and their stills (in `styles/`, the gallery and the releases) are by LemoLab. They are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit **LemoLab** with a link to [the original repository](https://github.com/lemomo-ai/lemo-opuscar). If you change them, say so.

## What we changed

- `core/render/video.mjs`: in-page WebCodecs hardware H.264 encoding as the default path, VideoToolbox and x264 fallbacks, an `--audio` option, and a check of the output stream.
- `core/mcp/server.mjs`: an MCP server that wraps the tools for coding agents.
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
