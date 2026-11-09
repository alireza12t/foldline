// Checks a finished film against what was asked for, and builds the ffmpeg pass that adds its sound. Used by video.mjs and mux.sh.
// Having a video and an audio stream isn't enough: a file can hold both and still end early (a missing chunk, a muxing step such as -shortest
// cutting the picture to a short soundtrack). So the check decodes the picture and counts its frames, and reads where each stream actually starts and ends.
//   node core/render/output.mjs check <file.mp4> --fps 24 (--frames 480 | --duration 20) [--audio full|short|none]
// --audio full (default): the soundtrack must start with the film and run to its end. short: it must start with the film and may end early, never late.
// none: the sound isn't checked. Prints "ok ..." and exits 0, or prints each problem and exits 1.
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const ff = (args, opts = {}) => execFileSync('ffprobe', ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// Container duration in seconds (NaN when ffprobe can't tell).
export function mediaDuration(file) {
  try { return num(ff(['-show_entries', 'format=duration', '-of', 'csv=p=0', file]).split('\n')[0]); } catch { return NaN; }
}

// What the file really holds: for the first video and first audio stream, where it starts (stream start time) and where its last packet ends.
// Video frames are counted by decoding them, not taken from the header (on all cores: about 2 s per minute of 1080p; single-threaded it's 7x slower).
export function probeOutput(file) {
  const res = { video: null, audio: null };
  let info;
  try { info = JSON.parse(ff(['-show_entries', 'stream=index,codec_type,start_time', '-of', 'json', file])); } catch (e) { res.error = String(e.stderr || e.message).trim().split('\n')[0]; return res; }
  const streams = info.streams || [], v = streams.find(s => s.codec_type === 'video'), a = streams.find(s => s.codec_type === 'audio');
  const ends = {};   // stream index → end of its last packet (pts + duration); B-frames reorder pts, so take the max
  for (const line of ff(['-show_entries', 'packet=stream_index,pts_time,duration_time', '-of', 'csv=p=0', file]).split('\n')) {
    const [i, pts, dur] = line.split(','); if (i === undefined || i === '') continue;
    const e = num(pts) + (num(dur) || 0); if (Number.isFinite(e) && !(ends[i] >= e)) ends[i] = e;
  }
  if (v) {
    let frames = 0;
    try { frames = parseInt(ff(['-threads', '0', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).split('\n')[0], 10) || 0; } catch {}
    res.video = { start: num(v.start_time) || 0, end: ends[v.index] ?? NaN, frames };
  }
  if (a) res.audio = { start: num(a.start_time) || 0, end: ends[a.index] ?? NaN };
  return res;
}

// Problems with the finished file, as sentences (empty array = fine). frames at fps is the film that was asked for.
// The picture may be off by one frame at most. The sound gets one frame too, but never less than 50 ms (an AAC frame is 21 ms at 48 kHz).
export function checkOutput(file, { frames, fps, audio = 'none' }) {
  const p = probeOutput(file), out = [], dur = frames / fps, f = 1 / fps, tolA = Math.max(f, 0.05), s = x => x.toFixed(3);
  if (p.error) return [`ffprobe could not read the file: ${p.error}`];
  const has = [p.video && 'video', p.audio && 'audio'].filter(Boolean).join(', ') || 'nothing';
  if (!p.video) out.push(`the finished file is missing its video stream (has: ${has})`);
  if (audio !== 'none' && !p.audio) out.push(`the finished file is missing its audio stream (has: ${has})`);
  if (p.video) {
    const { start, end, frames: n } = p.video;
    if (Math.abs(n - frames) > 1) out.push(`the picture has ${n} decoded frames, but ${frames} were rendered (${s(n / fps)} s of ${s(dur)} s at ${fps} fps)` +
      (n < frames ? ': it ends early, so something cut it short (a missing chunk, or a mux step such as -shortest)' : ''));
    if (Math.abs(start) > f) out.push(`the picture starts at ${s(start)} s instead of 0`);
    if (!(Math.abs(end - dur) <= f)) out.push(`the picture ends at ${s(end)} s instead of ${s(dur)} s`);
  }
  if (audio !== 'none' && p.audio) {
    const { start, end } = p.audio;
    if (Math.abs(start) > tolA) out.push(`the soundtrack starts at ${s(start)} s instead of with the picture at 0`);
    if (!(end <= dur + tolA)) out.push(`the soundtrack ends at ${s(end)} s, after the film's end at ${s(dur)} s`);
    else if (audio === 'full' && !(end >= dur - tolA)) out.push(`the soundtrack ends at ${s(end)} s, before the film's end at ${s(dur)} s` +
      ' (if a shorter soundtrack is intended, ask for it explicitly: --allow-short-audio, or allow_short_audio in render_video)');
  }
  return out;
}

// The ffmpeg arguments that put `audio` under `video` (copied, not re-encoded) and write `out`, `dur` seconds long.
// The picture is never cut: the output length is the film's (-t), not the shorter stream's (-shortest).
// A soundtrack shorter than the film is padded with silence to its end, unless allowShort says the shorter soundtrack is intended. A longer one is cut at the film's end.
// note: a line to print about what happened to a short soundtrack, or ''.
export function audioPassArgs({ video, audio, out, dur, fps, allowShort = false, audioDur = NaN, bitrate = '192k' }) {
  const short = audioDur > 0 && audioDur < dur - Math.max(1 / fps, 0.05), D = dur.toFixed(6);
  const note = !short ? '' : allowShort
    ? `note: the audio (${audioDur.toFixed(3)} s) ends before the film (${dur.toFixed(3)} s); kept short, as asked`
    : `note: the audio (${audioDur.toFixed(3)} s) is shorter than the film (${dur.toFixed(3)} s); padded with silence to the end (allow a short soundtrack to keep it short)`;
  return { note, args: ['-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    ...(allowShort ? [] : ['-af', `apad=whole_dur=${D}`]), '-c:a', 'aac', '-b:a', bitrate, '-t', D, '-movflags', '+faststart', out] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const file = a[1], fps = num(opt('--fps')), mode = opt('--audio') || 'full';
  const frames = opt('--frames') !== undefined ? parseInt(opt('--frames'), 10) : Math.round(num(opt('--duration')) * fps);
  if (a[0] !== 'check' || !file || !(fps > 0) || !(frames > 0) || !['full', 'short', 'none'].includes(mode)) {
    console.error('usage: node core/render/output.mjs check <file.mp4> --fps 24 (--frames N | --duration S) [--audio full|short|none]'); process.exit(2);
  }
  const problems = checkOutput(file, { frames, fps, audio: mode });
  if (problems.length) { for (const l of problems) console.error(l); process.exit(1); }
  console.log(`ok ${file}: ${frames} frames at ${fps} fps${mode === 'none' ? '' : `, soundtrack ${mode === 'full' ? 'covers the film' : 'within the film'}`}`);
}
