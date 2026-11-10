# Qwen3-TTS voice demo

`demo.wav` is the three lines in `lines.json`, voiced with Foldline's Qwen3-TTS engine (base model, built-in voices `ryan` and `aiden`) and joined with 0.4 s of silence between them. Line 2 ends on a year, where the plain model often cuts the end or misreads the number.

Made from the repo folder, on an M1 Pro with 16 GB:

```sh
sh plugin/skills/lemo-opuscar/scripts/setup.sh deps qwen
.venv/bin/python core/tts/tts_qwen.py examples/qwen-voice/lines.json out/qwen-voice
.venv/bin/python -c "import numpy as np, soundfile as sf; g = np.zeros(9600, np.float32); x = [sf.read(f'out/qwen-voice/{i}.wav', dtype='float32')[0] for i in ('d1', 'd2', 'd3')]; sf.write('out/qwen-voice/demo.wav', np.concatenate([x[0], g, x[1], g, x[2]]), 24000)"
```

Each run samples new takes, so yours will sound a little different. How the engine works, and what it fixes, is in the main README: [Voice with Qwen3-TTS](../../README.md#voice-with-qwen3-tts).
