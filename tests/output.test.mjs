// Tests for the finished-film check (core/render/output.mjs) and the sound passes of video.mjs and mux.sh.
// Run: npm test (needs ffmpeg and ffprobe). The fixtures are tiny films made with ffmpeg's test sources in a temporary folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { checkOutput, audioPassArgs, mediaDuration } from '../core/render/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 24, FRAMES = 48;   // the "requested render": 2 s at 24 fps
let dir; const f = n => path.join(dir, n);
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { cwd: dir });

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foldline-output-'));
  ffmpeg('-f', 'lavfi', '-i', `testsrc=s=320x180:r=${FPS}:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'video.mp4');   // picture only: what the render passes hand over
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=440:d=1:sample_rate=48000', 'audio-1s.wav');   // a soundtrack half as long as the film
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000', 'audio-2s.wav');
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=48000', 'audio-3s.wav');
  ffmpeg('-i', 'video.mp4', '-i', 'audio-2s.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', 'good.mp4');
  // Truncated output: the old audio pass (-shortest) with a soundtrack shorter than the film. Both streams are there, but the picture stops at the sound's end.
  ffmpeg('-i', 'video.mp4', '-i', 'audio-1s.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'truncated.mp4');
  // Full picture, short sound: the soundtrack ends halfway.
  ffmpeg('-i', 'video.mp4', '-i', 'audio-1s.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', 'short-audio.mp4');
  // Picture cut short with no sound at all (a missing last segment)
  ffmpeg('-i', 'video.mp4', '-c', 'copy', '-frames:v', '30', 'missing-chunk.mp4');
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('a complete film passes', () => {
  assert.deepEqual(checkOutput(f('good.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }), []);
  assert.deepEqual(checkOutput(f('video.mp4'), { frames: FRAMES, fps: FPS, audio: 'none' }), []);
});

test('missing stream: a picture-only file fails when sound was asked for', () => {
  const bad = checkOutput(f('video.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /missing its audio stream/);
});

test('truncated output: both streams present, but the picture ends early', () => {
  const bad = checkOutput(f('truncated.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' });
  assert.ok(!bad.some(l => /missing its/.test(l)), 'not a missing-stream failure');
  assert.ok(bad.some(l => /decoded frames, but 48 were rendered/.test(l) && /ends early/.test(l)), bad.join('\n'));
  // it is short even when a short soundtrack was allowed: the picture itself is cut
  assert.ok(checkOutput(f('truncated.mp4'), { frames: FRAMES, fps: FPS, audio: 'short' }).length > 0);
});

test('truncated output without sound: a missing chunk of picture fails', () => {
  const bad = checkOutput(f('missing-chunk.mp4'), { frames: FRAMES, fps: FPS, audio: 'none' });
  assert.ok(bad.some(l => /30 decoded frames, but 48/.test(l)), bad.join('\n'));
});

test('one frame of slack, not two', () => {
  assert.deepEqual(checkOutput(f('video.mp4'), { frames: FRAMES + 1, fps: FPS, audio: 'none' }).filter(l => /decoded frames/.test(l)), []);
  assert.ok(checkOutput(f('video.mp4'), { frames: FRAMES + 2, fps: FPS, audio: 'none' }).some(l => /decoded frames/.test(l)));
});

test('a soundtrack that ends early fails unless it was allowed', () => {
  const bad = checkOutput(f('short-audio.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' });
  assert.ok(bad.some(l => /soundtrack ends at 1\.0\d+ s, before the film's end/.test(l)), bad.join('\n'));
  assert.deepEqual(checkOutput(f('short-audio.mp4'), { frames: FRAMES, fps: FPS, audio: 'short' }), []);
});

// The sound pass video.mjs runs, on the same inputs it gets (merged picture + a sound file)
const pass = (audio, out, allowShort) => {
  const { args, note } = audioPassArgs({ video: 'video.mp4', audio, out, dur: FRAMES / FPS, fps: FPS, allowShort, audioDur: mediaDuration(f(audio)) });
  ffmpeg(...args); return note;
};

test('video.mjs sound pass: a short soundtrack is padded to the end, the picture is never cut', () => {
  const note = pass('audio-1s.wav', 'padded.mp4', false);
  assert.match(note, /padded with silence/);
  assert.deepEqual(checkOutput(f('padded.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }), []);
});

test('video.mjs sound pass: with a short soundtrack allowed, the sound stays short and the picture full', () => {
  assert.match(pass('audio-1s.wav', 'allowed.mp4', true), /kept short/);
  assert.deepEqual(checkOutput(f('allowed.mp4'), { frames: FRAMES, fps: FPS, audio: 'short' }), []);
  assert.ok(checkOutput(f('allowed.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }).length > 0);
});

test('video.mjs sound pass: a longer soundtrack is cut at the film\'s end', () => {
  assert.equal(pass('audio-3s.wav', 'long.mp4', false), '');
  assert.deepEqual(checkOutput(f('long.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }), []);
});

test('the command line reports problems and exits 1', () => {
  const run = file => spawnSync('node', [path.join(ROOT, 'core/render/output.mjs'), 'check', f(file), '--fps', String(FPS), '--frames', String(FRAMES)], { encoding: 'utf8' });
  assert.equal(run('good.mp4').status, 0);
  const r = run('truncated.mp4');
  assert.equal(r.status, 1); assert.match(r.stderr, /ends early/);
});

test('mux.sh: a short mix is padded, the film keeps every frame and passes its check', () => {
  const r = spawnSync('sh', [path.join(ROOT, 'core/render/mux.sh'), f('video.mp4'), f('audio-1s.wav'), f('muxed.mp4'), String(FPS), '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /padding it with silence/);
  assert.deepEqual(checkOutput(f('muxed.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }), []);
});

test('mux.sh: a long mix is cut at the picture\'s end', () => {
  const r = spawnSync('sh', [path.join(ROOT, 'core/render/mux.sh'), f('video.mp4'), f('audio-3s.wav'), f('muxed-long.mp4'), String(FPS), '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkOutput(f('muxed-long.mp4'), { frames: FRAMES, fps: FPS, audio: 'full' }), []);
});
