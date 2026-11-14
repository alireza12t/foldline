// ThreeRT pass: path-traced 3D frames (or still plates) rendered natively, outside Chrome, for a Foldline page to draw under its 2D layers.
//   node core/render/threert.mjs <film> [--quality fast|full] [--plates] [--force] [--from s] [--to s]
// <film>/threert/scene.ts  a ThreeRT scene (`@threert/scene`, three.js-style): default export () => ({ scene, camera })
// <film>/threert/shot.mjs  export default { fps: 24, dur: 5, camera: t => ({ position: [x,y,z], target: [x,y,z], fov }), plates: { name: { camera, time } } }
//                          camera(t) may return null (the scene's own camera); `plates` are single stills (storybook sets), no video frames.
// Writes <film>/threert/frames/f00000.png … (frame f is t = f / fps) and plates/<name>.png, plus manifest.json for core/threert.js.
// Unchanged frames are skipped (each frame's job and the scene bundle are hashed). Runs at nice 20 under $TMPDIR/unfold-chrome.lock.
// THREERT_HOME = the ThreeRT checkout with a built renderer (default ~/threert-build).
import { spawn, spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'; import { pathToFileURL } from 'url';

const QUALITY = {   // measured on an M1 Pro, 1080x1920 output (research/threert/REPORT.md)
  fast: { preset: 'preview', spp: 8, w: 720, h: 1280 },      // ~0.7 s a frame, 0.37 GB; the page scales it up
  full: { preset: 'cinematic', spp: 16, w: 1080, h: 1920 },  // ~3.1 s a frame, 0.7 GB
};
const args = process.argv.slice(2), flag = k => args.includes(k), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const film = args[0];
if (!film || film.startsWith('--')) { console.error('usage: node core/render/threert.mjs <film> [--quality fast|full] [--plates] [--force] [--from s] [--to s]'); process.exit(2); }
const dir = path.resolve(film, 'threert'), sceneTs = path.join(dir, 'scene.ts'), shotJs = path.join(dir, 'shot.mjs');
for (const f of [sceneTs, shotJs]) if (!fs.existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }
const home = process.env.THREERT_HOME || path.join(os.homedir(), 'threert-build');
const bin = path.join(home, 'renderer/target/release/threert-render');
if (!fs.existsSync(bin)) { console.error(`no ThreeRT renderer at ${bin} (build it: cd ${home}/renderer && nice -n 20 cargo build --release -j 4)`); process.exit(1); }

const shot = (await import(pathToFileURL(shotJs).href + '?' + Date.now())).default;
const qname = opt('--quality', shot.quality || 'fast'), Q = QUALITY[qname];
if (!Q) { console.error(`--quality must be ${Object.keys(QUALITY).join(' or ')}`); process.exit(2); }
const fps = shot.fps || 24, dur = shot.dur || 0;

// 1. bundle the scene (ThreeRT's own bundler; @threert/* resolve from the checkout)
const bundle = path.join(dir, '.bundle.js');
const entry = `const { bundleGame } = await import(${JSON.stringify(pathToFileURL(path.join(home, 'tools/bundle-game.ts')).href)}); await bundleGame(${JSON.stringify(sceneTs)}, ${JSON.stringify(bundle)});`;
const b = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', entry], { cwd: home, encoding: 'utf8' });   // a function call, not the script: its CLI needs Node 24
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }
const sceneHash = crypto.createHash('sha1').update(fs.readFileSync(bundle)).digest('hex').slice(0, 12);

// 2. the jobs
const manPath = path.join(dir, 'manifest.json');
const old = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
const man = { fps, dur, quality: qname, w: Q.w, h: Q.h, frames: old.quality === qname ? (old.frames || {}) : {}, plates: old.plates || {} };
const jobs = [], key = j => crypto.createHash('sha1').update(sceneHash + JSON.stringify(j)).digest('hex').slice(0, 12);
const base = { game: bundle, assets: home, room: 'local', seed: 1, spp: Q.spp, preset: Q.preset, width: Q.w, height: Q.h };
if (flag('--plates')) {
  for (const [name, p] of Object.entries(shot.plates || {})) {
    const j = { ...base, ...(p.camera ? { camera: p.camera } : {}), ...(p.time != null ? { time: p.time } : {}) }, out = path.join(dir, 'plates', `${name}.png`), k = key(j);
    if (flag('--force') || man.plates[name] !== k || !fs.existsSync(out)) jobs.push({ ...j, id: `plate:${name}`, out, k });
  }
} else {
  if (!dur) { console.error('shot.mjs needs dur (seconds) for frames, or use --plates'); process.exit(2); }
  const f0 = Math.round(+opt('--from', 0) * fps), f1 = Math.min(Math.round(+opt('--to', dur) * fps), Math.ceil(dur * fps) - 1);
  for (let f = f0; f <= f1; f++) {
    const t = f / fps, cam = shot.camera ? shot.camera(t) : null;
    const j = { ...base, time: t, ...(cam ? { camera: cam } : {}) }, out = path.join(dir, 'frames', `f${String(f).padStart(5, '0')}.png`), k = key(j);
    if (flag('--force') || man.frames[f] !== k || !fs.existsSync(out)) jobs.push({ ...j, id: `frame:${f}`, out, k });
  }
}
fs.mkdirSync(path.join(dir, flag('--plates') ? 'plates' : 'frames'), { recursive: true });
const save = () => fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
if (!jobs.length) { save(); console.log('nothing to render: every frame is up to date'); process.exit(0); }

// 3. render under the shared lock, one warm renderer for all jobs
const lock = path.join(process.env.TMPDIR || os.tmpdir(), 'unfold-chrome.lock');
try { fs.mkdirSync(lock); } catch { console.error(`render lock held (${lock}): another render is running; try again when it finishes`); process.exit(1); }
const unlock = () => { try { fs.rmdirSync(lock); } catch {} };
process.on('SIGINT', () => { unlock(); process.exit(130); }); process.on('SIGTERM', () => { unlock(); process.exit(143); });
const t0 = Date.now();
const child = spawn('nice', ['-n', '20', bin, 'serve'], { cwd: home, stdio: ['pipe', 'pipe', 'inherit'] });
let done = 0, failed = 0, buf = '';
const byId = Object.fromEntries(jobs.map(j => [j.id, j]));
child.stdout.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.id || !byId[r.id]) continue;
    const j = byId[r.id], [kind, n] = r.id.split(':');
    if (r.ok) { done++; if (kind === 'frame') man.frames[n] = j.k; else man.plates[n] = j.k; }
    else { failed++; console.error(`${r.id}: ${r.error || line.slice(0, 300)}`); }
    if (done % 24 === 0 || done + failed === jobs.length) { save(); process.stdout.write(`\r${done + failed}/${jobs.length} ${((Date.now() - t0) / 1000 / (done + failed)).toFixed(2)} s each`); }
  }
});
for (const j of jobs) { const { k, ...job } = j; child.stdin.write(JSON.stringify(job) + '\n'); }
child.stdin.end();
const code = await new Promise(r => child.on('close', r));
unlock(); save(); fs.rmSync(bundle, { force: true });
console.log(`\n${done} rendered, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s (${qname}: ${Q.preset}, ${Q.spp} spp, ${Q.w}x${Q.h})`);
process.exit(failed || code ? 1 : 0);
