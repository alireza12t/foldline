// Page side of the ThreeRT pass (core/render/threert.mjs renders the frames natively first).
//   import { loadThreeRT } from '/core/threert.js';
//   const rt = await loadThreeRT('threert/');          // folder with manifest.json, relative to the page
//   window.render = async t => { await rt.draw(ctx, t); /* your 2D layers on top */ };
//   await rt.plate(ctx, 'kitchen')                       // a still plate (storybook set) instead of video frames
// draw() covers the canvas (scaled up from the fast 720x1280 frames when needed) and waits for the image, so frames stay deterministic.
export async function loadThreeRT(base = 'threert/') {
  if (!base.endsWith('/')) base += '/';
  const r = await fetch(base + 'manifest.json');
  if (!r.ok) throw new Error(`ThreeRT manifest missing at ${base}manifest.json: run node core/render/threert.mjs <film> first`);
  const man = await r.json(), cache = new Map();
  const get = async src => {
    let p = cache.get(src);
    if (!p) { p = (async () => { const im = new Image(); im.src = src; await im.decode(); return im; })(); cache.set(src, p); if (cache.size > 8) cache.delete(cache.keys().next().value); }
    return p;
  };
  const cover = (ctx, im) => {
    const W = ctx.canvas.width, H = ctx.canvas.height, s = Math.max(W / im.width, H / im.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
  };
  const last = Math.max(0, Math.ceil(man.dur * man.fps) - 1);
  return {
    manifest: man,
    frameAt: t => Math.min(last, Math.max(0, Math.round(t * man.fps))),
    async draw(ctx, t) { const f = this.frameAt(t); cover(ctx, await get(`${base}frames/f${String(f).padStart(5, '0')}.png`)); return f; },
    async plate(ctx, name) { cover(ctx, await get(`${base}plates/${name}.png`)); },
  };
}
