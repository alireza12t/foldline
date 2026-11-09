# Foldline plugin

Adds the [Foldline](https://github.com/alireza12t/foldline) MCP server to Claude Code. It runs `npx -y foldline-mcp`, so it needs Node 20+, ffmpeg (`brew install ffmpeg`) and Chrome's headless shell (`npx playwright-core@1.63.0 install chromium-headless-shell`). The server tells you if one is missing.

```sh
claude plugin install foldline --marketplace alireza12t/foldline
```

Open source, free for non-commercial use (PolyForm Noncommercial 1.0.0).
