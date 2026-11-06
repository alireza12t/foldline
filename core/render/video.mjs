// Render video: node core/render/video.mjs <demo> [--fps 24] [--workers 3] [--q 'k=v'] [--out <demo>/out/video.mp4] [--size 1920x1080] [--audio mix.wav]
// Foldline: by default the page encodes H.264 itself (WebCodecs on the Mac's hardware encoder), see "Encoder" below. --audio muxes a sound file in (AAC 192k).
// when several films are in production in parallel, use 3 workers (the default); a render on its own can go up to 6
// each worker has its own browser; JPEG screenshots are piped to ffmpeg; the segments are joined losslessly at the end
// with the environment variable RENDER_SLOTS (an integer) set, the machine runs at most that many full-film renders at once (slot.mjs); unset means no limit. Segment files go in a hidden directory next to --out, unique to each render, deleted when the render finishes (or fails, or is interrupted).
// The same demo can render several versions in parallel, but each version needs its own --out: two renders writing the same --out fail with an error instead of silently overwriting each other.
// <out>.lock holds the owner's pid; if the owner is gone, or the lock file hasn't been refreshed for over 12 hours (the pid was reused by another process), it counts as stale and a new render takes over.
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { openDemo, closeServer, requireDemo, takeSize } from './page.mjs';
const args = process.argv.slice(2), { w: W, h: H } = takeSize(args), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args[0]; requireDemo(dir);
const FPS = +opt('--fps', 24), WK = +opt('--workers', 3), Q = opt('--q', ''), AUDIO = opt('--audio', '');
if (AUDIO && !fs.existsSync(AUDIO)) { console.error(`--audio file not found: ${AUDIO}`); process.exit(2); }
if (!(FPS > 0) || !Number.isInteger(WK) || WK < 1) { console.error('bad --fps / --workers: fps must be > 0, workers an integer ≥ 1'); process.exit(2); }
const out = path.resolve(opt('--out', path.join(dir, 'out', 'video.mp4')));
const outDir = path.dirname(out), base = path.basename(out, path.extname(out));
fs.mkdirSync(outDir, { recursive: true });

// —— only one render may write a given --out: <out>.lock holds the pid ——
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lock = out + '.lock', LOCK_MAX_AGE = 12 * 3600 * 1000;
try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch {
  const other = Number(fs.readFileSync(lock, 'utf8')), age = Date.now() - fs.statSync(lock).mtimeMs;
  if (Number.isInteger(other) && other > 0 && alive(other) && age < LOCK_MAX_AGE) {
    console.error(`another render (pid ${other}) is already writing ${out}. Give this one its own --out.\n` +
      `If no render is running (a crashed one can leave its lock behind), delete ${lock} and run this again.`); process.exit(2);
  }
  fs.writeFileSync(lock, String(process.pid));   // the previous render crashed (or its pid is now used by another process, or the lock is too old): take over
}
setInterval(() => { try { const n = new Date(); fs.utimesSync(lock, n, n); } catch {} }, 10 * 60 * 1000).unref();   // long renders refresh it periodically so they aren't taken for stale
// clear out segment directories left by crashes (whose pid is gone)
for (const n of fs.readdirSync(outDir)) if (n.startsWith(`.${base}_segs-`)) {
  try { const p = Number(fs.readFileSync(path.join(outDir, n, 'pid'), 'utf8')); if (!alive(p)) fs.rmSync(path.join(outDir, n), { recursive: true, force: true }); } catch {}
}
let segDir = null, cleaned = false; const procs = new Set();   // running ffmpeg processes: stop them before cleaning the directory, so they don't error on a deleted directory
const cleanup = () => { if (cleaned) return; cleaned = true; for (const p of procs) p.kill('SIGKILL'); if (segDir) fs.rmSync(segDir, { recursive: true, force: true }); try { fs.unlinkSync(lock); } catch {} };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(128 + (sig === 'SIGINT' ? 2 : 15)); });
const fail = msg => { console.error(msg); cleanup(); process.exit(1); };

const release = process.env.RENDER_SLOTS ? await (await import('./slot.mjs')).acquire() : () => {};   // with RENDER_SLOT_HELD=1 (an outer process already holds a slot), pass straight through
segDir = fs.mkdtempSync(path.join(outDir, `.${base}_segs-`)); fs.writeFileSync(path.join(segDir, 'pid'), String(process.pid));
const probe = await openDemo(dir, { w: W, h: H, q: Q }); const DUR = await probe.page.evaluate(() => window.DUR);
// Encoder, Foldline default (FOLDLINE_ENC=auto, or wc): H.264 encoded inside the page with WebCodecs on the Mac's hardware encoder. Frames go canvas → encoder on the GPU: no screenshot,
// no JPEG, no mjpeg decode. Needs the film drawn into one visible <canvas id="c"> of the render size (Unfold longs and Shorts are). Otherwise, or if the
// browser has no hardware H.264 encoder, it falls back to vt. FOLDLINE_MBPS (or LEMO_WC_MBPS) sets the bitrate (default 20).
// FOLDLINE_ENC=vt forces the old screenshot path with the hardware encoder, FOLDLINE_ENC=x264 the original lemo path.
const WC_CFG = { codec: 'avc1.640033', width: W, height: H, framerate: FPS, bitrate: parseFloat(process.env.FOLDLINE_MBPS || process.env.LEMO_WC_MBPS || '20') * 1e6, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality', avc: { format: 'annexb' } };
let WC = false;
const WANT = process.env.FOLDLINE_ENC || process.env.LEMO_ENC || 'auto';   // auto = wc, else vt, else x264
if (WANT === 'auto' || WANT === 'wc') WC = await probe.page.evaluate(async cfg => {
  const c = document.getElementById('c'); if (!c || c.tagName !== 'CANVAS' || c.width !== cfg.width || c.height !== cfg.height || !('VideoEncoder' in window)) return false;
  const vis = [...document.body.querySelectorAll('*')].filter(e => !['SCRIPT', 'STYLE'].includes(e.tagName) && e.getBoundingClientRect().width > 0);
  if (vis.length !== 1) return false;
  try { return (await VideoEncoder.isConfigSupported(cfg)).supported === true; } catch { return false; }
}, WC_CFG).catch(() => false);
if ((WANT === 'auto' || WANT === 'wc') && !WC) console.error('[note] WebCodecs path not used (the page is not one #c canvas of the render size, or the browser has no hardware H.264 encoder): using vt');
await probe.browser.close();
if (!(DUR > 0)) fail(`window.DUR must be a positive number of seconds (got ${DUR})`);
const TOTAL = Math.round(DUR * FPS), per = Math.ceil(TOTAL / WK), t0 = Date.now();
// Encoder for the screenshot path. FOLDLINE_ENC=x264: x264 medium crf 14 (lemo's original). vt uses the Mac's hardware H.264 encoder (VideoToolbox):
// it uses ~70% less CPU and ~0.8 GB less RAM than 3 x264 encoders (Unfold EP6, Nov 6; Shorts also render ~35% faster). Meant for films that go through mux.sh, which re-encodes
// the picture anyway. LEMO_VTQ sets its quality (default 72: files about the size of x264 crf 14, PSNR 47.6 dB against them; after mux.sh the films differ by 46.7 dB, same colour averages). Falls back to x264 if the hardware encoder is unavailable.
let ENC = WC ? 'wc' : (WANT === 'auto' || WANT === 'wc') ? 'vt' : WANT;
if (ENC === 'vt') { try { execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=s=${W}x${H}:d=0.1`, '-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-f', 'null', '-'], { stdio: 'ignore' }); }
  catch { console.error('[note] LEMO_ENC=vt: VideoToolbox unavailable, using x264'); ENC = 'x264'; } }
const ENC_ARGS = ENC === 'vt' ? ['-c:v', 'h264_videotoolbox', '-q:v', process.env.LEMO_VTQ || '72', '-allow_sw', '0', '-bsf:v', 'h264_metadata=matrix_coefficients=5']
  : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14'];
try { await Promise.all([...Array(WK)].map(async (_, w) => {
  const a = w * per, b = Math.min(TOTAL, a + per); if (a >= b) return;
  const { browser, page } = await openDemo(dir, { w: W, h: H, q: Q });
  if (WC) {   // the page encodes; we only collect the H.264 stream (keyframe every 2 s, one page call per 2 s)
    await page.evaluate(({ cfg, fps }) => {
      const c = document.getElementById('c'); window.__chunks = []; window.__err = null;
      window.__enc = new VideoEncoder({ output: ch => { const u = new Uint8Array(ch.byteLength); ch.copyTo(u); window.__chunks.push(u); }, error: e => { window.__err = e.message; } });
      window.__enc.configure(cfg);
      window.__go = async (f0, f1) => { for (let f = f0; f < f1; f++) {
        await window.render(f / fps);
        const vf = new VideoFrame(c, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        window.__enc.encode(vf, { keyFrame: (f - f0) % (2 * fps) === 0 }); vf.close();
        while (window.__enc.encodeQueueSize > 4) await new Promise(r => { window.__enc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 500); });   // event, not a 0 ms timer (4 ms clamp)
        if (window.__err) throw new Error('encoder: ' + window.__err); } };
      window.__take = async flush => { if (flush) await window.__enc.flush(); if (window.__err) throw new Error('encoder: ' + window.__err);
        const cs = window.__chunks; window.__chunks = []; let n = 0; for (const u of cs) n += u.length;
        const all = new Uint8Array(n); let o = 0; for (const u of cs) { all.set(u, o); o += u.length; }
        let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); };
    }, { cfg: WC_CFG, fps: FPS });
    const fd = fs.openSync(path.join(segDir, `seg_${w}.h264`), 'w'), step = Math.max(1, Math.round(2 * FPS));
    for (let f = a; f < b; f += step) {
      await page.evaluate(([x, y]) => window.__go(x, y), [f, Math.min(b, f + step)]);
      fs.writeSync(fd, Buffer.from(await page.evaluate(() => window.__take(false)), 'base64'));
      if (Math.floor((f - a) / 600) !== Math.floor((f - a + step) / 600)) console.log(`w${w} ${f - a}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    fs.writeSync(fd, Buffer.from(await page.evaluate(() => window.__take(true)), 'base64')); fs.closeSync(fd); await browser.close(); return;
  }
  // cwd set to the segment directory with relative filenames: that way ffmpeg won't read characters such as # ? in the path as protocol syntax
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...ENC_ARGS, '-pix_fmt', 'yuv420p', `seg_${w}.mp4`], { cwd: segDir, stdio: ['pipe', 'inherit', 'inherit'] });
  procs.add(ff); ff.on('close', () => procs.delete(ff));
  let dead = null;   // ffmpeg exited early (missing encoder, disk full…): its own error is already on stderr; here we just note it and stop feeding frames
  let done; const closed = new Promise(r => { done = r; }); ff.on('close', code => done(code));
  ff.on('error', e => { dead = e.code === 'ENOENT' ? 'ffmpeg is not installed (or not on PATH)' : e.message; done(-1); });
  ff.stdin.on('error', () => { dead ??= 'ffmpeg closed its input early'; });
  for (let f = a; f < b && !dead; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (dead) break;
    if (!ff.stdin.write(buf)) await Promise.race([new Promise(r => ff.stdin.once('drain', r)), closed]);
    if ((f - a) % 60 === 0) console.log(`w${w} ${f - a}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); const code = await closed; await browser.close();
  if (dead || code !== 0) fail(`ffmpeg failed for worker ${w}: ${dead || 'exit code ' + code} (ffmpeg's own message, if any, is above)`);
})); } catch (e) { fail(`render stopped: ${String(e.message || e).split('\n')[0]}`); }   // e.g. the page's render(t) threw
if (WC) {   // raw H.264 segments join by plain concatenation, then get wrapped (video only, like the other paths); -r gives the frame timing; transfer tagged bt709 (Chrome writes sRGB).
  // Add audio in a SECOND ffmpeg run from this mp4, never straight from the raw .h264: raw H.264 has no timestamps and -shortest then drops the audio.
  fs.writeFileSync(path.join(segDir, 'all.h264'), Buffer.concat([...Array(WK)].map((_, w) => w).filter(w => w * per < TOTAL).map(w => fs.readFileSync(path.join(segDir, `seg_${w}.h264`)))));
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-r', String(FPS), '-f', 'h264', '-i', 'all.h264', '-c', 'copy', '-bsf:v', 'h264_metadata=transfer_characteristics=1',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', 'merged.mp4'], { cwd: segDir, stdio: ['ignore', 'inherit', 'inherit'] }); }
  catch { fail('ffmpeg could not wrap the H.264 stream (its message is above)'); }
} else {
const list = path.join(segDir, 'segs.txt');
fs.writeFileSync(list, [...Array(WK)].map((_, w) => `file 'seg_${w}.mp4'`).filter((_, w) => w * per < TOTAL).join('\n'));
try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'segs.txt', '-c', 'copy', 'merged.mp4'], { cwd: segDir, stdio: ['ignore', 'inherit', 'inherit'] }); }
catch { fail('ffmpeg could not join the segments (its message is above)'); }
}
if (AUDIO) {   // second run from the finished mp4 (never from raw .h264: without timestamps, -shortest drops the audio)
  fs.copyFileSync(path.resolve(AUDIO), path.join(segDir, 'audio.in'));
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'merged.mp4', '-i', 'audio.in', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'final.mp4'],
    { cwd: segDir, stdio: ['ignore', 'inherit', 'inherit'] }); fs.renameSync(path.join(segDir, 'final.mp4'), path.join(segDir, 'merged.mp4')); }
  catch { fail('ffmpeg could not add the audio (its message is above)'); }
}
{ const st = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', 'merged.mp4'], { cwd: segDir, encoding: 'utf8' }).split('\n').map(l => l.split(',')[0].trim()).filter(Boolean);   // ffprobe may print 'video,' (extra columns)
  if (!st.includes('video') || (AUDIO && !st.includes('audio'))) fail(`the finished file is missing a stream (has: ${st.join(', ') || 'nothing'})`); }   // never hand over a silent or empty video
fs.renameSync(path.join(segDir, 'merged.mp4'), out);   // any characters in the final filename are fine: it doesn't go through ffmpeg
cleanup(); release();
const secs = (Date.now() - t0) / 1000;
console.log('done', out, TOTAL, 'frames', secs.toFixed(0) + 's', `(${(TOTAL / secs).toFixed(0)} fps)`, 'enc=' + ENC + (AUDIO ? ' +audio' : ''));
closeServer();
