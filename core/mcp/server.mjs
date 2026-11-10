#!/usr/bin/env node
// Foldline MCP server: gives coding agents (Claude Code, Cursor, Codex, ...) Foldline's tools over the Model Context Protocol (stdio).
// Add it with:  claude mcp add foldline -- node /path/to/foldline/core/mcp/server.mjs
// It wraps the existing commands in core/ and returns short results, so an agent doesn't read whole guides or long render logs.
// Relative paths are taken from the library root. Absolute paths are safer.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(LIB, 'package.json'), 'utf8')).version;
const abs = p => path.resolve(LIB, p.replace(/^~(?=$|\/)/, os.homedir()));
const TAIL = 40;   // lines of output kept when a command fails

// Installed with npm or npx, the dependencies sit next to this package instead of inside it.
// Pages load /node_modules/... from the library root, so point LIB/node_modules at them.
const NM = path.join(LIB, 'node_modules');
if (!fs.existsSync(NM) && path.basename(path.dirname(LIB)) === 'node_modules') { try { fs.symlinkSync('..', NM); } catch {} }

// ---------- helpers ----------

// Python for the voice, music and sheet tools: FOLDLINE_PYTHON, then the library's .venv, then lemo-opuscar's .venv.
function python() {
  const tries = [process.env.FOLDLINE_PYTHON, path.join(LIB, '.venv/bin/python'),
    path.join(process.env.LEMO_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar'), '.venv/bin/python')].filter(Boolean);
  const hit = tries.find(p => fs.existsSync(p));
  if (!hit) throw new Error(`No Python environment found (tried ${tries.join(', ')}). Run "sh plugin/skills/lemo-opuscar/scripts/setup.sh deps" (add "voice", "qwen" or "music" for those tools), or set FOLDLINE_PYTHON.`);
  return hit;
}

// Runs a command from the library root at low priority. onLine sees each output line as it arrives.
function run(cmd, args, { onLine, signal, nice = true, env = {} } = {}) {
  return new Promise(resolve => {
    const [bin, argv] = nice ? ['nice', ['-n', '20', cmd, ...args]] : [cmd, args];
    const child = spawn(bin, argv, { cwd: LIB, env: { ...process.env, ...env } });
    const lines = [];
    let buf = { out: '', err: '' };
    const feed = (k, chunk) => {
      buf[k] += chunk;
      const parts = buf[k].split(/\r?\n/); buf[k] = parts.pop();
      for (const l of parts) { lines.push(l); onLine?.(l); }
    };
    child.stdout.on('data', c => feed('out', c));
    child.stderr.on('data', c => feed('err', c));
    const stop = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', stop);
    child.on('error', e => { lines.push(String(e)); });
    child.on('close', code => {
      signal?.removeEventListener('abort', stop);
      for (const k of ['out', 'err']) if (buf[k]) lines.push(buf[k]);
      resolve({ code: code ?? 1, lines });
    });
  });
}

const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = t => ({ content: [{ type: 'text', text: t }], isError: true });
const PW = JSON.parse(fs.readFileSync(path.join(LIB, 'package.json'), 'utf8')).dependencies['playwright-core'];
const tail = lines => {
  const t = lines.join('\n');
  if (/Executable doesn't exist/.test(t)) return `Chrome's headless shell is not installed. Install it once with:\n  npx playwright-core@${PW} install chromium-headless-shell\nor set PLAYWRIGHT_CHROME to a chrome-headless-shell you have.`;
  if (/ffmpeg: (command )?not found|spawn ffmpeg ENOENT/.test(t)) return 'ffmpeg is not installed. On a Mac: brew install ffmpeg';
  return lines.slice(-TAIL).join('\n');
};
const sizeArgs = (size, q) => [...(size ? ['--size', size] : []), ...(q ? ['--q', q] : [])];
const sizeSchema = z.string().regex(/^\d+x\d+$/).optional().describe('Frame size WxH, even numbers. Default 1920x1080; 1080x1920 for a vertical Short.');
const qSchema = z.string().optional().describe("Query string passed to the page as location.search, e.g. 'lang=en&cut=b'.");
const demoSchema = z.string().describe('Folder that holds the film\'s index.html (absolute path, or relative to the library root).');

function progress(extra) {
  const token = extra?._meta?.progressToken;
  if (token === undefined) return () => {};
  let last = 0;
  return (done, total, message) => {
    const now = Date.now(); if (now - last < 1000 && done < total) return; last = now;
    extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message } }).catch(() => {});
  };
}

// ---------- style library ----------

function styles() {
  const dir = path.join(LIB, 'styles');
  return fs.readdirSync(dir).filter(s => !s.startsWith('_') && fs.existsSync(path.join(dir, s, 'style.json')))
    .map(s => JSON.parse(fs.readFileSync(path.join(dir, s, 'style.json'), 'utf8')));
}

const GUIDES = {
  agents: 'AGENTS.md', director: 'DIRECTOR.md', technique: 'TECHNIQUE.md', 'my-styles': 'MY-STYLES.md',
  tools: 'core/README.md', instruments: 'core/audio/INSTRUMENTS.md', readme: 'README.md', notice: 'NOTICE.md',
};

// Splits markdown into sections by "#" headings (outside code fences).
function sections(md) {
  const out = []; let cur = { title: '(top)', level: 0, body: [] }, fence = false;
  for (const l of md.split('\n')) {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,4})\s+(.*)$/.exec(l);
    if (m) { out.push(cur); cur = { title: m[2].trim(), level: m[1].length, body: [l] }; } else cur.body.push(l);
  }
  out.push(cur);
  return out.filter(s => s.body.join('').trim());
}

// ---------- server ----------

const server = new McpServer({ name: 'foldline', version: VERSION }, {
  instructions: 'Foldline renders an HTML page with a <canvas> and window.render(t) to an MP4, and ships 66 film styles. ' +
    'Start with find_styles / get_style to pick a look, read_guide for how to direct and build a film (ask for one section at a time), ' +
    'render_stills to review frames, check_reading for on-screen text timing, then render_video. Voice: make_voice and check_voice. Sound: mux_audio. ' +
    'Renders run at low priority and print only a short result.',
});

const RO = { readOnlyHint: true, openWorldHint: false };

server.registerTool('find_styles', {
  title: 'Find film styles',
  description: 'Search the 66 film styles by words (name, category, use, demo film). Returns one short line per style. Leave query empty to list all.',
  inputSchema: { query: z.string().optional().describe('Words to match, e.g. "paper", "news", "3d", "kids".') },
  annotations: RO,
}, async ({ query }) => {
  const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits = styles().filter(s => {
    const hay = [s.slug, s.en, s.cn, s.category_en, s.film, s.line, ...(s.uses || [])].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
  if (!hits.length) return text(`No style matches "${query}". Try fewer words, or call find_styles with no query to list all.`);
  return text(hits.map(s => `${s.slug} · ${s.en} (${s.category_en}) · demo "${s.film}": ${s.line} · uses: ${(s.uses || []).join(', ')}`).join('\n') +
    `\n\n${hits.length} style(s). get_style <slug> gives the full style prompt.`);
});

server.registerTool('get_style', {
  title: 'Get a style prompt',
  description: "Returns a style's STYLE.md: its look, rules and prompt. include_demo adds DEMO.md (how its demo film was made), which is long.",
  inputSchema: { slug: z.string().describe('Style folder, e.g. "art-deco". Use find_styles to look one up.'), include_demo: z.boolean().optional() },
  annotations: RO,
}, async ({ slug, include_demo }) => {
  const dir = path.join(LIB, 'styles', path.basename(slug));
  const f = path.join(dir, 'STYLE.md');
  if (!fs.existsSync(f)) return fail(`No style "${slug}". Use find_styles to see the folder names.`);
  let out = fs.readFileSync(f, 'utf8');
  if (include_demo && fs.existsSync(path.join(dir, 'DEMO.md'))) out += '\n\n---\n\n' + fs.readFileSync(path.join(dir, 'DEMO.md'), 'utf8');
  return text(out);
});

server.registerTool('read_guide', {
  title: 'Read a guide',
  description: 'Reads one of the library guides. Without a section it returns the table of contents only, so you can ask for just the part you need. ' +
    'Guides: agents (how to direct and produce a film), director (story, sound, rhythm, camera, checks), technique (page contract, voice, music, mix), ' +
    'my-styles (making a style your own), tools (every command and flag), instruments (sampled instruments), readme, notice (licences).',
  inputSchema: {
    guide: z.enum(Object.keys(GUIDES)),
    section: z.string().optional().describe('Heading text (or part of it) to return, with its subsections.'),
    full: z.boolean().optional().describe('Return the whole guide. Long; prefer a section.'),
  },
  annotations: RO,
}, async ({ guide, section, full }) => {
  const md = fs.readFileSync(path.join(LIB, GUIDES[guide]), 'utf8');
  if (full) return text(md);
  const secs = sections(md);
  if (!section) {
    return text(`${GUIDES[guide]} (${md.length} chars). Sections:\n` +
      secs.filter(s => s.level).map(s => `${'  '.repeat(s.level - 1)}- ${s.title} (${s.body.join('\n').length})`).join('\n') +
      '\n\nCall read_guide again with section set to one of these headings.');
  }
  const i = secs.findIndex(s => s.title.toLowerCase().includes(section.toLowerCase()));
  if (i < 0) return fail(`No section matching "${section}" in ${GUIDES[guide]}. Call read_guide without section for the list.`);
  const lvl = secs[i].level, part = [secs[i]];
  for (let j = i + 1; j < secs.length && secs[j].level > lvl; j++) part.push(secs[j]);
  return text(part.map(s => s.body.join('\n')).join('\n').trim());
});

server.registerTool('render_stills', {
  title: 'Render review stills',
  description: 'Renders JPEG stills of a film at given seconds, to look at before a full render. Returns the file paths. ' +
    'With sheet=true it also makes one contact sheet and returns it as an image, which is cheaper to look at than many stills.',
  inputSchema: {
    demo: demoSchema,
    times: z.array(z.number().nonnegative()).optional().describe('Seconds to render, e.g. [0, 2.5, 10].'),
    range: z.string().regex(/^[\d.]+:[\d.]+:[\d.]+$/).optional().describe('start:end:step in seconds, e.g. "0:30:5".'),
    out: z.string().optional().describe('Folder for the stills. Default <demo>/stills.'),
    size: sizeSchema, q: qSchema,
    sheet: z.boolean().optional().describe('Also make a contact sheet (needs the Python environment) and return it inline.'),
    sheet_cols: z.number().int().min(1).max(8).optional(),
  },
}, async ({ demo, times = [], range, out, size, q, sheet, sheet_cols }, extra) => {
  if (!times.length && !range) return fail('Give times or range.');
  const args = ['core/render/still.mjs', abs(demo), ...times.map(String), ...(range ? ['--range', range] : []), ...(out ? ['--out', abs(out)] : []), ...sizeArgs(size, q)];
  const r = await run('node', args, { signal: extra.signal });
  if (r.code) return fail(`still.mjs failed (exit ${r.code}):\n${tail(r.lines)}`);
  const files = r.lines.map(l => l.split(' ')[0]).filter(f => f.endsWith('.jpg'));
  if (!sheet) return text(files.join('\n'));
  const sheetFile = path.join(path.dirname(files[0]), 'sheet.jpg');
  let py; try { py = python(); } catch (e) { return text(files.join('\n') + `\n\nNo contact sheet: ${e.message}`); }
  const s = await run(py, ['core/render/sheet.py', sheetFile, ...files, '--cols', String(sheet_cols || 4), '--w', '400'], { signal: extra.signal });
  if (s.code) return text(files.join('\n') + `\n\nContact sheet failed:\n${tail(s.lines)}`);
  return { content: [
    { type: 'text', text: `${files.join('\n')}\nsheet: ${sheetFile} (left to right, top to bottom: ${times.length ? times.join(', ') + ' s' : range})` },
    { type: 'image', data: fs.readFileSync(sheetFile).toString('base64'), mimeType: 'image/jpeg' },
  ] };
});

server.registerTool('render_video', {
  title: 'Render the film to MP4',
  description: 'Renders every frame of a film to an H.264 MP4 at low priority, with the in-page hardware encoder by default. ' +
    'Before saving, it checks the file: every rendered frame decodes and the soundtrack runs from the start to the end of the film; a short or misaligned file fails. ' +
    'Returns the output path, frame count, time and encoder (enc=wc is the fast path), not the progress log. Sends progress if the client asks for it.',
  inputSchema: {
    demo: demoSchema,
    out: z.string().optional().describe('Output mp4. Default <demo>/out/video.mp4. Each parallel render needs its own out.'),
    fps: z.number().positive().optional().describe('Default 24.'),
    workers: z.number().int().min(1).max(6).optional().describe('Parallel browser workers. Default 3.'),
    size: sizeSchema, q: qSchema,
    audio: z.string().optional().describe('Sound file to mux in (AAC 192k). A soundtrack shorter than the film is padded with silence; a longer one is cut at the end. For a mastered mix use mux_audio instead.'),
    allow_short_audio: z.boolean().optional().describe('Set true only when the soundtrack is meant to end before the film: it is then left short instead of padded. Default false.'),
    encoder: z.enum(['auto', 'wc', 'vt', 'x264']).optional().describe('auto (default) tries WebCodecs, then VideoToolbox, then x264.'),
    mbps: z.number().positive().optional().describe('Bitrate for the WebCodecs path. Default 20.'),
  },
}, async ({ demo, out, fps, workers, size, q, audio, allow_short_audio, encoder, mbps }, extra) => {
  const args = ['core/render/video.mjs', abs(demo), ...(out ? ['--out', abs(out)] : []), ...(fps ? ['--fps', String(fps)] : []),
    ...(workers ? ['--workers', String(workers)] : []), ...sizeArgs(size, q), ...(audio ? ['--audio', abs(audio)] : []),
    ...(audio && allow_short_audio ? ['--allow-short-audio'] : [])];
  const env = { ...(encoder ? { FOLDLINE_ENC: encoder } : {}), ...(mbps ? { FOLDLINE_MBPS: String(mbps) } : {}) };
  const report = progress(extra), per = {};
  const r = await run('node', args, {
    signal: extra.signal, env,
    onLine: l => {
      const m = /^w(\d+) (\d+)\/(\d+)/.exec(l); if (!m) return;
      per[m[1]] = [+m[2], +m[3]];
      const v = Object.values(per), done = v.reduce((a, x) => a + x[0], 0), total = v.reduce((a, x) => a + x[1], 0);
      report(done, total, `${done}/${total} frames`);
    },
  });
  const done = r.lines.find(l => l.startsWith('done '));
  if (r.code || !done) return fail(`video.mjs failed (exit ${r.code}):\n${tail(r.lines)}`);
  const notes = r.lines.filter(l => /fall|warn|optional file missing|the audio \(/i.test(l));
  return text(done + (notes.length ? `\n${notes.slice(0, 3).join('\n')}${notes.length > 3 ? `\n(+${notes.length - 3} more notes like these)` : ''}` : ''));
});

server.registerTool('check_reading', {
  title: 'Check on-screen text timing',
  description: 'Checks that every on-screen text stays fully in frame long enough to read (the page must expose window.TEXTS(t)). Returns only the failures and a count.',
  inputSchema: {
    demo: demoSchema, size: sizeSchema, q: qSchema,
    step: z.number().positive().optional().describe('Seconds between checks. Default 0.04.'),
    latin_cps: z.number().positive().optional().describe('Latin characters per second. Default 15.'),
    cjk_cps: z.number().positive().optional().describe('CJK characters per second. Default 4.5.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ demo, size, q, step, latin_cps, cjk_cps }, extra) => {
  const args = ['core/render/readcheck.mjs', abs(demo), ...sizeArgs(size, q), ...(step ? ['--step', String(step)] : []),
    ...(latin_cps ? ['--latin-cps', String(latin_cps)] : []), ...(cjk_cps ? ['--cjk-cps', String(cjk_cps)] : [])];
  const r = await run('node', args, { signal: extra.signal });
  const ok = r.lines.filter(l => l.startsWith('OK ')).length, bad = r.lines.filter(l => l.startsWith('BAD'));
  if (r.code === 2) return fail(`Could not check: ${tail(r.lines)}`);
  if (r.code && !bad.length) return fail(`readcheck.mjs failed (exit ${r.code}):\n${tail(r.lines)}`);
  return text(bad.length ? `${bad.length} text(s) too short or out of frame, ${ok} fine:\n${bad.join('\n')}` : `All ${ok} texts are on screen long enough.`);
});

server.registerTool('export_events', {
  title: 'Export sound cues',
  description: "Exports the page's window.DUR and window.EV (sound and cue events) to JSON for the mix. Returns the path and the number of events.",
  inputSchema: { demo: demoSchema, out: z.string().optional().describe('Default <demo>/events.json.'), size: sizeSchema, q: qSchema },
}, async ({ demo, out, size, q }, extra) => {
  const file = out ? abs(out) : path.join(abs(demo), 'events.json');
  const r = await run('node', ['core/render/events.mjs', abs(demo), '--out', file, ...sizeArgs(size, q)], { signal: extra.signal });
  if (r.code) return fail(`events.mjs failed (exit ${r.code}):\n${tail(r.lines)}`);
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return text(`${file}: ${j.dur} s, ${(j.ev || []).length} events`); }
  catch { return text(`${file}\n${tail(r.lines)}`); }
});

server.registerTool('make_voice', {
  title: 'Make voice lines (TTS)',
  description: 'Turns lines of text into trimmed WAV files and dur.json. engine "kokoro" is offline (default); "edge" is Microsoft Edge TTS, online; ' +
    '"qwen" is Qwen3-TTS on MLX (Mac with Apple silicon, local, free; voices ryan, aiden, vivian, serena, uncle_fu, dylan, eric, ono_anna, sohee; ' +
    'per-line instruct; numbers spelled out; every take checked for a cut end and by Whisper, bad takes redone). ' +
    'Returns each line\'s duration. Needs the voice tier (setup.sh deps voice), or for qwen the qwen tier (setup.sh deps qwen; the model, about 3.1 GB, downloads on first use).',
  inputSchema: {
    lines: z.array(z.object({
      id: z.string(), text: z.string(), voice: z.string().optional(), speed: z.number().optional().describe('kokoro only.'),
      lang: z.string().optional().describe('kokoro: en-us, cmn…; qwen: english (default), chinese, japanese, korean, german, french, russian, portuguese, spanish, italian.'),
      say: z.string().optional().describe('edge and qwen: what is spoken when it differs from text.'),
      instruct: z.string().optional().describe('qwen only: how to say it, e.g. "warm, clear narrator, natural pace".'),
      asr: z.string().optional().describe('qwen check and check_voice: what Whisper should hear when it differs.'),
    })).min(1),
    out_dir: z.string().describe('Folder for <id>.wav and dur.json. lines.json is written there too.'),
    engine: z.enum(['kokoro', 'edge', 'qwen']).optional(),
  },
}, async ({ lines, out_dir, engine = 'kokoro' }, extra) => {
  let py; try { py = python(); } catch (e) { return fail(e.message); }
  const dir = abs(out_dir); fs.mkdirSync(dir, { recursive: true });
  const lj = path.join(dir, 'lines.json'); fs.writeFileSync(lj, JSON.stringify(lines, null, 1));
  const script = { edge: 'core/tts/tts_zh.py', qwen: 'core/tts/tts_qwen.py' }[engine] || 'core/tts/tts.py';
  const r = await run(py, [script, lj, dir], { signal: extra.signal });
  if (r.code) return fail(`TTS failed (exit ${r.code}):\n${tail(r.lines)}`);
  const notes = r.lines.filter(l => /^(guard:|STILL FAILING|warning:)/.test(l));   // qwen: redo summary and lines that still fail
  try { return text([dir, JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'dur.json'), 'utf8'))), ...notes].join('\n')); }
  catch { return text(`${dir}\n${tail(r.lines)}`); }
});

server.registerTool('check_voice', {
  title: 'Check voice lines with speech-to-text',
  description: 'Runs Whisper over every <id>.wav and compares it with the text. Writes words.json (word timestamps). Returns only the lines that failed and a count.',
  inputSchema: {
    lines_json: z.string().describe('The lines.json used for the voice.'),
    voices_dir: z.string(),
    lang: z.enum(['en', 'zh', 'auto']).optional(),
  },
  annotations: { readOnlyHint: true },
}, async ({ lines_json, voices_dir, lang }, extra) => {
  let py; try { py = python(); } catch (e) { return fail(e.message); }
  const r = await run(py, ['core/tts/asr_check.py', abs(lines_json), abs(voices_dir), ...(lang ? ['--lang', lang] : [])], { signal: extra.signal });
  if (r.code === 0) return text(`All lines match. Word timestamps: ${path.join(abs(voices_dir), 'words.json')}\n${r.lines.slice(-3).join('\n')}`);
  if (r.code === 2) return fail(`Whisper model failed to load:\n${tail(r.lines)}`);
  const bad = r.lines.filter(l => /^DIFF|^mismatches:/.test(l));
  if (!bad.length) return fail(`asr_check.py failed (exit ${r.code}):\n${tail(r.lines)}`);
  return fail(`Some lines don't match:\n${bad.join('\n')}`);
});

server.registerTool('mux_audio', {
  title: 'Mux and master sound',
  description: 'Puts a mix under the video: two-pass loudness to -14 LUFS, true peak -1.2 dB, optional film grain. A mix shorter than the video is padded with silence, a longer one cut at the end. ' +
    'Before handing over, it checks the frame count and that the sound starts and ends with the picture. Returns the output path and the measured loudness.',
  inputSchema: {
    video: z.string(), audio: z.string().describe('The mix, e.g. mix.wav.'), out: z.string(),
    fps: z.number().positive().optional().describe('Default 24.'),
    grain: z.number().min(0).optional().describe('Film grain, 0 for none. Default 2.'),
  },
}, async ({ video, audio, out, fps, grain }, extra) => {
  const args = ['core/render/mux.sh', abs(video), abs(audio), abs(out), ...(fps || grain !== undefined ? [String(fps || 24)] : []), ...(grain !== undefined ? [String(grain)] : [])];
  const r = await run('sh', args, { signal: extra.signal });
  if (r.code) return fail(`mux.sh failed (exit ${r.code}):\n${tail(r.lines)}`);
  return text(`${abs(out)}\n${r.lines.filter(l => /LUFS|peak|warn|note/i.test(l)).slice(-6).join('\n')}`);
});

server.registerTool('make_subtitles', {
  title: 'Make an SRT file',
  description: 'Writes an .srt subtitle file from cues.',
  inputSchema: { cues: z.array(z.object({ t0: z.number(), t1: z.number(), text: z.string() })).min(1), out: z.string().describe('Path of the .srt.') },
}, async ({ cues, out }, extra) => {
  let py; try { py = python(); } catch (e) { return fail(e.message); }
  const file = abs(out), cj = file.replace(/\.srt$/i, '') + '.cues.json';
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(cj, JSON.stringify(cues));
  const r = await run(py, ['core/render/srt.py', cj, file], { signal: extra.signal, nice: false });
  if (r.code) return fail(`srt.py failed (exit ${r.code}):\n${tail(r.lines)}`);
  return text(`${file} (${cues.length} cues)`);
});

server.registerTool('fetch_assets', {
  title: 'Download optional big assets',
  description: 'Downloads assets that are not shipped with Foldline into its library folder: the Kokoro voice model (voice), the HDRI skies that 3D styles light with (hdri), or a sampled instrument library (instruments).',
  inputSchema: {
    what: z.enum(['voice', 'hdri', 'instruments']),
    lib: z.enum(['freepats', 'karoryfer', 'salamander', 'vcsl', 'vsco2ce', 'all']).optional().describe('For instruments: which library.'),
  },
  annotations: { openWorldHint: true },
}, async ({ what, lib }, extra) => {
  if (what === 'instruments' && !lib) return fail('Say which instrument library: freepats, karoryfer, salamander, vcsl, vsco2ce or all.');
  const r = await run('sh', ['tools/fetch.sh', what, ...(lib ? [lib] : [])], { signal: extra.signal, nice: false });
  if (r.code) return fail(`fetch.sh failed (exit ${r.code}):\n${tail(r.lines)}`);
  return text(`Done.\n${r.lines.filter(l => /^[✓↓]|already/i.test(l.trim())).join('\n')}`);
});

await server.connect(new StdioServerTransport());
