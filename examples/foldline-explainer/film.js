// Foldline explainer: one #c canvas (1920x1080), deterministic render(t), timings from voices/dur.json + voices/words.json.
// Everything is computed from t (no state carried between frames). Style stills in scene 10: LemoLab, CC BY 4.0.
const W = 1920, H = 1080;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');

// ---------- palette and type ----------
const INK = '#10141c', PANEL = '#1a202c', PANEL2 = '#232b3a', CARD = '#f3efe6', CORAL = '#ff6a3d', TEAL = '#2ec4a6', YEL = '#ffd166';
const TXT = '#f3efe6', DIM = '#9aa3b5', LINEC = 'rgba(243,239,230,0.12)';
const FAM = { ui: 'Fredoka', big: '"Lilita One"', mono: 'Menlo, Monaco, monospace' };

// ---------- small math ----------
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, u) => a + (b - a) * u;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = x => 1 - Math.pow(1 - clamp(x), 3);
const eio = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x, s = 1.70158) => { x = clamp(x) - 1; return 1 + x * x * ((s + 1) * x + s); };
const TAU = Math.PI * 2;
function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mod = (a, n) => ((a % n) + n) % n;

// ---------- drawing helpers ----------
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function setFont(g, size, weight, fam) { g.font = `${weight} ${size}px ${fam}`; }
function fontOf(o) { const fam = o.fam || 'ui'; return { fam: FAM[fam], w: o.weight ?? (fam === 'ui' ? 600 : 400) }; }
function text(g, s, x, y, o = {}) {
  const f = fontOf(o); let sz = o.size || 36; setFont(g, sz, f.w, f.fam);
  if (o.maxW) while (g.measureText(s).width > o.maxW && sz > 10) { sz -= 1; setFont(g, sz, f.w, f.fam); }
  g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'alphabetic'; g.fillStyle = o.color || TXT;
  g.fillText(s, x, y); return g.measureText(s).width;
}
function tw(g, s, size, o = {}) { const f = fontOf(o); setFont(g, size, f.w, f.fam); return g.measureText(s).width; }
function shadowFill(g, fill, blur = 36, oy = 12, a = .45) { g.save(); g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = blur; g.shadowOffsetY = oy; g.fillStyle = fill; g.fill(); g.restore(); }
function glowStroke(g, color, width, blur) { g.save(); g.shadowColor = color; g.shadowBlur = blur; g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.restore(); }
function glass(g, x, y, w, h, r, o = {}) {   // glassy card: soft shadow, translucent fill, top sheen, hairline border
  g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = o.blur ?? 46; g.shadowOffsetY = o.oy ?? 18;
  rr(g, x, y, w, h, r); g.fillStyle = o.fill || 'rgba(28,35,48,.82)'; g.fill(); g.restore();
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,255,255,.075)'); gr.addColorStop(.3, 'rgba(255,255,255,.018)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  rr(g, x, y, w, h, r); g.fillStyle = gr; g.fill();
  rr(g, x + .75, y + .75, w - 1.5, h - 1.5, r); g.strokeStyle = o.stroke || 'rgba(255,255,255,.10)'; g.lineWidth = 1.5; g.stroke();
  g.save(); rr(g, x, y, w, h, r); g.clip(); const hl = g.createLinearGradient(x, 0, x + w, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(.5, 'rgba(255,255,255,.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(x + r, y, w - 2 * r, 1.5); g.restore();
}
// scale-pop around a point: p 0..1 (back easing), fades in
function pop(g, cx, cy, p, fn, from = .6) {
  if (p <= 0) return; const s = lerp(from, 1, back(p)), a = clamp(p * 1.8);
  g.save(); g.globalAlpha *= a; g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy); fn(); g.restore();
}
function fadeUp(g, p, dy, fn) { if (p <= 0) return; const e = eo(p); g.save(); g.globalAlpha *= clamp(p * 1.5); g.translate(0, dy * (1 - e)); fn(); g.restore(); }
function pill(g, x, y, s, o = {}) {   // x,y = left/center-y; returns width
  const size = o.size || 30, padX = o.padX ?? size * .7, h = o.h || size * 1.6, w = tw(g, s, size, o) + padX * 2;
  const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  rr(g, x0, y - h / 2, w, h, h / 2); g.fillStyle = o.bg || TEAL; g.fill();
  if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = 3; g.stroke(); }
  text(g, s, x0 + w / 2, y + 1, { ...o, align: 'center', base: 'middle', size, color: o.color || INK }); return w;
}
function checkMark(g, cx, cy, r, bg, p = 1, fg = INK) {
  if (p <= 0) return; const s = back(clamp(p * 1.6));
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = bg; g.fill();
  const pts = [[-.45 * r, .02 * r], [-.12 * r, .34 * r], [.46 * r, -.32 * r]], L = 1.25 * r;
  g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.lineTo(...pts[2]);
  g.setLineDash([L * clamp(p * 1.4 - .2), L * 2]); g.strokeStyle = fg; g.lineWidth = r * .24; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  g.restore();
}
function arrow(g, x1, y1, x2, y2, color, w = 6, p = 1, head = 18) {
  if (p <= 0) return; const x = lerp(x1, x2, p), y = lerp(y1, y2, p), a = Math.atan2(y2 - y1, x2 - x1);
  g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x - Math.cos(a) * head * .6, y - Math.sin(a) * head * .6); g.stroke();
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a - .5) * head, y - Math.sin(a - .5) * head); g.lineTo(x - Math.cos(a + .5) * head, y - Math.sin(a + .5) * head); g.closePath(); g.fill();
  g.restore();
}
function stopwatch(g, cx, cy, r, ang, color) {
  g.save(); g.lineWidth = r * .12; g.strokeStyle = color; g.fillStyle = PANEL;
  rr(g, cx - r * .18, cy - r * 1.32, r * .36, r * .22, 4); g.fillStyle = color; g.fill();
  g.beginPath(); g.moveTo(cx, cy - r * 1.1); g.lineTo(cx, cy - r); g.stroke();
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = PANEL; g.fill(); g.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * .72, cy + Math.sin(a) * r * .72); g.lineTo(cx + Math.cos(a) * r * .84, cy + Math.sin(a) * r * .84); g.lineWidth = r * .05; g.stroke(); }
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ang) * r * .7, cy - Math.cos(ang) * r * .7); g.lineWidth = r * .09; g.lineCap = 'round'; g.stroke();
  g.beginPath(); g.arc(cx, cy, r * .1, 0, TAU); g.fillStyle = color; g.fill();
  g.restore();
}

// ---------- icons (centered at cx,cy, size s) ----------
function icCanvas(g, cx, cy, s, c) {
  g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = s * .08; g.lineJoin = 'round';
  rr(g, cx - s * .55, cy - s * .4, s * 1.1, s * .8, s * .1); g.stroke();
  g.beginPath(); g.moveTo(cx - s * .4, cy + s * .26); g.lineTo(cx - s * .1, cy - s * .08); g.lineTo(cx + .08 * s, cy + s * .12); g.lineTo(cx + s * .22, cy); g.lineTo(cx + s * .4, cy + s * .26); g.closePath(); g.fill();
  g.beginPath(); g.arc(cx + s * .25, cy - s * .18, s * .09, 0, TAU); g.fill(); g.restore();
}
function icCamera(g, cx, cy, s, c) {
  g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = s * .08; g.lineJoin = 'round';
  rr(g, cx - s * .55, cy - s * .28, s * 1.1, s * .66, s * .12); g.stroke();
  rr(g, cx - s * .2, cy - s * .42, s * .4, s * .16, s * .05); g.fill();
  g.beginPath(); g.arc(cx, cy + s * .05, s * .2, 0, TAU); g.stroke();
  g.beginPath(); g.arc(cx + s * .38, cy - s * .14, s * .05, 0, TAU); g.fill(); g.restore();
}
function icFile(g, cx, cy, s, c, label) {
  g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = s * .08; g.lineJoin = 'round';
  const x = cx - s * .36, y = cy - s * .48, w = s * .72, h = s * .96, f = s * .22;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - f, y); g.lineTo(x + w, y + f); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(x + w - f, y); g.lineTo(x + w - f, y + f); g.lineTo(x + w, y + f); g.stroke();
  text(g, label, cx, cy + s * .22, { fam: 'big', size: s * .26, color: c, align: 'center', base: 'middle' }); g.restore();
}
function icPipe(g, cx, cy, s, c) {
  g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = s * .08; g.lineJoin = 'round';
  rr(g, cx - s * .5, cy - s * .16, s, s * .32, s * .06); g.stroke();
  rr(g, cx - s * .62, cy - s * .26, s * .14, s * .52, s * .04); g.fill();
  rr(g, cx + s * .48, cy - s * .26, s * .14, s * .52, s * .04); g.fill();
  g.beginPath(); g.moveTo(cx - s * .2, cy - s * .16); g.lineTo(cx - s * .2, cy + s * .16); g.moveTo(cx + s * .2, cy - s * .16); g.lineTo(cx + s * .2, cy + s * .16); g.stroke(); g.restore();
}
function icDecode(g, cx, cy, s, c) {
  g.save(); g.strokeStyle = c; g.fillStyle = c; g.lineWidth = s * .08; g.lineCap = 'round'; g.lineJoin = 'round';
  const q = s * .14;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { rr(g, cx + dx * q * 1.15 - q / 2, cy + dy * q * 1.15 - q / 2, q, q, 3); g.fill(); }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x0 = cx + dx * s * .3, y0 = cy + dy * s * .3, x1 = cx + dx * s * .5, y1 = cy + dy * s * .5;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.moveTo(x1, y1); g.lineTo(x1 - dx * s * .14, y1); g.moveTo(x1, y1); g.lineTo(x1, y1 - dy * s * .14); g.stroke();
  }
  g.restore();
}
function icGear(g, cx, cy, s, c, rot = 0) {
  g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = c;
  g.beginPath(); const n = 8;
  for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU, r = i % 2 ? s * .36 : s * .48; const a0 = a - TAU / (n * 4) * .55, a1 = a + TAU / (n * 4) * .55; g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); }
  g.closePath(); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, s * .17, 0, TAU); g.fill(); g.restore();
}
function icSpeaker(g, cx, cy, s, c, lt) {
  g.save(); g.fillStyle = c; g.strokeStyle = c; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - s * .5, cy - s * .16); g.lineTo(cx - s * .28, cy - s * .16); g.lineTo(cx + s * .02, cy - s * .42); g.lineTo(cx + s * .02, cy + s * .42); g.lineTo(cx - s * .28, cy + s * .16); g.lineTo(cx - s * .5, cy + s * .16); g.closePath(); g.fill();
  for (let i = 0; i < 3; i++) {
    const ph = (lt * 1.2 + i / 3) % 1, a = .35 + .65 * Math.sin(Math.PI * ph);
    g.globalAlpha = a; g.lineWidth = s * .07; g.beginPath(); g.arc(cx + s * .05, cy, s * (.22 + i * .14), -.7, .7); g.stroke();
  }
  g.restore();
}

// ---------- timings ----------
const IDS = ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12'];
const [DJ, WJ, SCRIPT] = await Promise.all([fetch('voices/dur.json').then(r => r.json()), fetch('voices/words.json').then(r => r.json()),
  fetch('tts/lines.json').then(r => r.ok ? r.json() : []).catch(() => [])]);   // script text (optional): captions show it with the ASR word times
const D = {}, S = {};
IDS.forEach((id, i) => { D[id] = +DJ[id]; S[id] = i === 0 ? 0.8 : S[IDS[i - 1]] + D[IDS[i - 1]] + 0.4; });
const DUR = S.l12 + D.l12 + 3.0;
window.DUR = DUR;
window.LINES = IDS.map(id => ({ id, start: S[id], dur: D[id] }));
const WORDS = {}; for (const id of IDS) WORDS[id] = (WJ[id] || []).map(w => [String(w[0]), +w[1], +w[2]]);
const norm = s => s.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'%-]/g, '');
// time (relative to the line start) of the nth word starting with key; fallback = frac of the line
// key may be a list of alternatives ('four' or '4'); numbers must match exactly
function wt(id, key, frac, nth = 0, end = false) {
  const keys = Array.isArray(key) ? key : [key]; let k = 0;
  const hit = n => keys.some(q => /^[0-9%]+$/.test(q) ? n.replace(/[.,]$/, '') === q : n.startsWith(q));
  for (const w of WORDS[id]) if (hit(norm(w[0]))) { if (k++ === nth) return clamp(end ? w[2] : w[1], 0, D[id]); }
  return frac * D[id];
}
const TR = 0.5;   // transition length
const MID = IDS.slice(1).map(id => S[id] - 0.2);   // transition centres (middle of each 0.4 s gap)

// ---------- precomputed art ----------
// The little scene that runs through the film (same composition as the code in scene 2)
function flatScene(g, w, h, o = {}) {
  g.fillStyle = '#1b3a5c'; g.fillRect(0, 0, w, h);
  const k = h / 600;
  g.fillStyle = YEL; g.beginPath(); g.arc(w * .75, (o.sunY ?? 170) * k, (o.r ?? 70) * k, 0, TAU); g.fill();
  g.fillStyle = TEAL; g.fillRect(0, 440 * k, w, h - 440 * k);
  g.fillStyle = o.house || CORAL; g.fillRect(w * .225, 300 * k, w * .25, 140 * k);
}
function paperScene(g, w, h) {
  g.fillStyle = '#efe6d4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#bcd9e4'; g.fillRect(0, 0, w, h);
  const sh = (fill) => { g.save(); g.shadowColor = 'rgba(60,40,20,.35)'; g.shadowBlur = 14; g.shadowOffsetY = 6; g.fillStyle = fill; g.fill(); g.restore(); };
  // clouds
  for (const [x, y, s] of [[.18, .2, 1], [.5, .13, .8]]) { g.beginPath(); g.ellipse(w * x, h * y, 70 * s, 26 * s, 0, 0, TAU); g.ellipse(w * x + 40 * s, h * y - 16 * s, 46 * s, 30 * s, 0, 0, TAU); sh('#fbf7ee'); }
  g.beginPath(); g.arc(w * .75, h * .283, h * .117, 0, TAU); sh('#ffc94d');
  g.beginPath(); g.moveTo(0, h * .66); g.bezierCurveTo(w * .25, h * .52, w * .45, h * .7, w * .7, h * .6); g.bezierCurveTo(w * .85, h * .55, w * .95, h * .6, w, h * .62); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); sh('#8fcfb0');
  g.beginPath(); g.moveTo(0, h * .76); g.bezierCurveTo(w * .3, h * .7, w * .6, h * .8, w, h * .72); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); sh('#4fb08c');
  const hx = w * .225, hy = h * .5, hw = w * .25, hh = h * .233;
  g.beginPath(); g.rect(hx, hy, hw, hh); sh('#ff8a5c');
  g.beginPath(); g.moveTo(hx - 14, hy + 2); g.lineTo(hx + hw / 2, hy - hh * .62); g.lineTo(hx + hw + 14, hy + 2); g.closePath(); sh('#d4553a');
  g.beginPath(); g.rect(hx + hw * .42, hy + hh * .45, hw * .17, hh * .55); sh('#7a3b2e');
  g.beginPath(); g.rect(hx + hw * .12, hy + hh * .25, hw * .18, hh * .26); sh('#ffe9a8');
  g.beginPath(); g.rect(hx + hw * .7, hy + hh * .25, hw * .18, hh * .26); sh('#ffe9a8');
  // grain
  const r = mulberry(7); g.save();
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < .5 ? 'rgba(90,60,30,.06)' : 'rgba(255,255,255,.08)'; g.fillRect(r() * w, r() * h, 2, 2); }
  g.restore();
}
function neonScene(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d0624'); gr.addColorStop(.65, '#3a0d4a'); gr.addColorStop(.66, '#120720'); gr.addColorStop(1, '#07030f');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const r = mulberry(11); g.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 70; i++) { g.fillRect(r() * w, r() * h * .55, 2, 2); }
  const hz = h * .66, sx = w * .7, sy = h * .43, sr = h * .21;
  const sg = g.createLinearGradient(0, sy - sr, 0, sy + sr); sg.addColorStop(0, '#ffe066'); sg.addColorStop(1, '#ff2fa8');
  g.save(); g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.clip(); g.fillStyle = sg; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  g.fillStyle = '#2a0b3c'; for (let i = 0; i < 6; i++) { const yy = sy + sr * (.1 + i * .16); g.fillRect(sx - sr, yy, sr * 2, 3 + i * 2.2); } g.restore();
  g.save(); g.beginPath(); g.rect(0, hz, w, h - hz); g.clip(); g.strokeStyle = '#ff3df2'; g.lineWidth = 2; g.shadowColor = '#ff3df2'; g.shadowBlur = 10;
  for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(w / 2 + i * 40, hz); g.lineTo(w / 2 + i * 260, h); g.stroke(); }
  for (let i = 0; i < 9; i++) { const yy = hz + (h - hz) * Math.pow(i / 8, 2); g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
  g.restore();
  g.beginPath(); g.moveTo(0, hz); g.lineTo(w, hz); glowStroke(g, '#ff7af5', 3, 18);
  const hx = w * .225, hy = h * .44, hw = w * .25, hh = h * .22;
  g.lineJoin = 'round';
  g.beginPath(); g.rect(hx, hy, hw, hh); glowStroke(g, '#3df5ff', 4, 22);
  g.beginPath(); g.moveTo(hx - 12, hy); g.lineTo(hx + hw / 2, hy - hh * .6); g.lineTo(hx + hw + 12, hy); glowStroke(g, '#3df5ff', 4, 22);
  g.beginPath(); g.rect(hx + hw * .42, hy + hh * .45, hw * .17, hh * .55); glowStroke(g, '#ffe066', 3, 16);
  g.beginPath(); g.rect(hx + hw * .12, hy + hh * .25, hw * .18, hh * .26); glowStroke(g, '#ff3df2', 3, 16);
}
function pixelScene(w, h) {
  const sw = 96, shh = 54, s = mk(sw, shh), g = s.getContext('2d');
  g.fillStyle = '#29366f'; g.fillRect(0, 0, sw, shh); g.fillStyle = '#3b5dc9'; g.fillRect(0, 14, sw, 40); g.fillStyle = '#41a6f6'; g.fillRect(0, 26, sw, 30);
  g.fillStyle = '#ffcd75'; for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 38) g.fillRect(72 + x, 15 + y, 1, 1);
  g.fillStyle = '#f4f4f4'; g.fillRect(14, 8, 14, 3); g.fillRect(17, 6, 7, 2); g.fillRect(44, 12, 10, 2); g.fillRect(46, 10, 5, 2);
  g.fillStyle = '#38b764'; g.fillRect(0, 40, sw, 14); g.fillStyle = '#a7f070'; g.fillRect(0, 40, sw, 2);
  g.fillStyle = '#257179'; for (let x = 3; x < sw; x += 9) g.fillRect(x, 46 + (x % 3), 2, 1);
  g.fillStyle = '#b13e53'; g.fillRect(22, 28, 24, 12);
  g.fillStyle = '#5d275d'; for (let i = 0; i < 8; i++) g.fillRect(21 + i, 27 - i, 26 - 2 * i, 1);
  g.fillStyle = '#ef7d57'; g.fillRect(32, 33, 4, 7); g.fillStyle = '#ffcd75'; g.fillRect(25, 31, 4, 3); g.fillRect(39, 31, 4, 3);
  const out = mk(w, h), o = out.getContext('2d'); o.imageSmoothingEnabled = false; o.drawImage(s, 0, 0, w, h);
  o.strokeStyle = 'rgba(0,0,0,.08)'; o.lineWidth = 1; for (let x = 0; x <= w; x += w / sw) { o.beginPath(); o.moveTo(x, 0); o.lineTo(x, h); o.stroke(); } for (let y = 0; y <= h; y += h / shh) { o.beginPath(); o.moveTo(0, y); o.lineTo(w, y); o.stroke(); }
  return out;
}
// richer sunset picture for "same picture" (scene 8)
function sunsetScene(g, w, h) {
  const k = w / 1520, r = mulberry(21);
  const sky = g.createLinearGradient(0, 0, 0, h * .7); sky.addColorStop(0, '#2b2a5e'); sky.addColorStop(.45, '#a8517a'); sky.addColorStop(.8, '#ff9a6c'); sky.addColorStop(1, '#ffd29a');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 60; i++) { const s = r() * 2.5 + 1; g.fillRect(r() * w, r() * h * .3, s * k * 1.5, s * k * 1.5); }
  const sg = g.createRadialGradient(w * .62, h * .56, 0, w * .62, h * .56, 330 * k); sg.addColorStop(0, 'rgba(255,240,180,.9)'); sg.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = sg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe3a0'; g.beginPath(); g.arc(w * .62, h * .56, 110 * k, 0, TAU); g.fill();
  const hill = (y0, amp, f, ph, col) => { g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x / w * f + ph) * amp + Math.sin(x / w * f * 2.3 + ph * 2) * amp * .35); g.lineTo(w, h); g.closePath(); g.fillStyle = col; g.fill(); };
  hill(h * .6, 40 * k, 7, 1, '#7a4b86'); hill(h * .66, 34 * k, 5, 2.4, '#4f3f7a');
  // lake
  g.fillStyle = '#3a4f8a'; g.fillRect(0, h * .74, w, h * .26);
  g.fillStyle = 'rgba(255,227,160,.6)'; for (let i = 0; i < 9; i++) { const ww = (220 - i * 18) * k; g.fillRect(w * .62 - ww / 2, h * .76 + i * 14 * k, ww, 5 * k); }
  hill(h * .76, 18 * k, 4, .3, '#25335f');
  g.fillStyle = '#25335f'; g.fillRect(0, h * .8, w * .42, h * .2);
  // trees
  for (let i = 0; i < 9; i++) { const x = (40 + i * 70 + r() * 30) * k, hh = (90 + r() * 70) * k, y = h * .8 + (r() * 10) * k; g.fillStyle = '#18223f'; g.beginPath(); g.moveTo(x, y - hh); g.lineTo(x + hh * .32, y); g.lineTo(x - hh * .32, y); g.closePath(); g.fill(); }
  // house
  const hx = 300 * k, hy = h * .8 - 120 * k;
  g.fillStyle = CORAL; g.fillRect(hx, hy, 190 * k, 120 * k); g.fillStyle = '#b8402a'; g.beginPath(); g.moveTo(hx - 18 * k, hy); g.lineTo(hx + 95 * k, hy - 80 * k); g.lineTo(hx + 208 * k, hy); g.closePath(); g.fill();
  g.fillStyle = YEL; g.fillRect(hx + 28 * k, hy + 36 * k, 42 * k, 36 * k); g.fillRect(hx + 120 * k, hy + 36 * k, 42 * k, 36 * k);
  g.fillStyle = '#5a2a20'; g.fillRect(hx + 80 * k, hy + 62 * k, 32 * k, 58 * k);
  // birds
  g.strokeStyle = '#2b2a5e'; g.lineWidth = 4 * k; g.lineCap = 'round';
  for (const [x, y, s] of [[.78, .22, 1], [.83, .27, .8], [.74, .29, .7], [.3, .18, .9]]) { g.beginPath(); g.moveTo(w * x - 22 * s * k, h * y - 8 * s * k); g.quadraticCurveTo(w * x - 8 * s * k, h * y - 12 * s * k, w * x, h * y); g.quadraticCurveTo(w * x + 8 * s * k, h * y - 12 * s * k, w * x + 22 * s * k, h * y - 8 * s * k); g.stroke(); }
}

let STRIP, SW = 1400, SH = 300, BG, GRID, LOOK = {}, MINI, PIX1, PIX2, SUNSET, TILES = [];
function buildArt() {
  // FOLDLINE paper strip
  STRIP = mk(SW, SH); { const g = STRIP.getContext('2d');
    const pg = g.createLinearGradient(0, 0, 0, SH); pg.addColorStop(0, '#f7f3ea'); pg.addColorStop(1, '#e8e1d2'); g.fillStyle = pg; g.fillRect(0, 0, SW, SH);
    const r = mulberry(3); for (let i = 0; i < 2500; i++) { g.fillStyle = r() < .5 ? 'rgba(80,60,30,.05)' : 'rgba(255,255,255,.12)'; g.fillRect(r() * SW, r() * SH, 2, 2); }
    setFont(g, 236, 400, FAM.big); const w1 = g.measureText('FOLD').width, w2 = g.measureText('LINE').width, x0 = (SW - w1 - w2) / 2;
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = INK; g.fillText('FOLD', x0, SH * .47); g.fillStyle = '#16a386'; g.fillText('LINE', x0 + w1, SH * .47);
    g.strokeStyle = '#16a386'; g.lineWidth = 5; g.setLineDash([22, 14]); g.beginPath(); g.moveTo(40, SH - 34); g.lineTo(SW - 40, SH - 34); g.stroke(); }
  // background (vignette) and grid
  BG = mk(W, H); { const g = BG.getContext('2d'); g.fillStyle = INK; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W / 2, H * .42, 100, W / 2, H * .45, 1150); rg.addColorStop(0, '#1a2130'); rg.addColorStop(.6, '#11161f'); rg.addColorStop(1, '#07090d'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
  GRID = mk(W + 120, H + 120); { const g = GRID.getContext('2d'); g.strokeStyle = 'rgba(243,239,230,.035)'; g.lineWidth = 1;
    for (let x = 0; x <= W + 120; x += 60) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H + 120); g.stroke(); }
    for (let y = 0; y <= H + 120; y += 60) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W + 120, y + .5); g.stroke(); }
    g.fillStyle = 'rgba(243,239,230,.07)'; for (let x = 0; x <= W + 120; x += 240) for (let y = 0; y <= H + 120; y += 240) g.fillRect(x - 1, y - 1, 3, 3); }
  // looks of the little scene
  for (const k of ['flat', 'paper', 'neon']) { LOOK[k] = mk(960, 540); const g = LOOK[k].getContext('2d'); if (k === 'flat') flatScene(g, 960, 540); else if (k === 'paper') paperScene(g, 960, 540); else neonScene(g, 960, 540); }
  LOOK.pixel = pixelScene(960, 540);
  MINI = mk(240, 150); flatScene(MINI.getContext('2d'), 240, 150);
  PIX1 = mk(240, 150); { const s = mk(12, 8); s.getContext('2d').drawImage(MINI, 0, 0, 12, 8); const g = PIX1.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(s, 0, 0, 240, 150); }
  PIX2 = mk(240, 150); { const s = mk(30, 19); s.getContext('2d').drawImage(MINI, 0, 0, 30, 19); const g = PIX2.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(s, 0, 0, 240, 150); }
  SUNSET = mk(1520, 856); sunsetScene(SUNSET.getContext('2d'), 1520, 856);
}
const SLUGS = ['watercolor', 'pixel-rpg', 'ukiyoe', 'blueprint', 'chalkboard', 'dataviz', 'art-deco', 'ink-wash', 'risograph', 'stained-glass', 'cel-anime-80s', 'lowpoly-island',
  'papercut-red', 'silent-film', 'hologram-hud', 'woodcut', 'crayon-book', 'tilt-shift', 'transit-map', 'impasto', 'swiss-motion', 'spy-titles', 'rubber-hose', 'midcentury-toon',
  'shadow-puppet', 'isometric-picture-book', 'ascii-crt', 'brick-toy', 'paper-lantern', 'hd-2d', 'newsreel', 'whiteboard', 'scifi-toon', 'circuit-board', 'memphis-diorama', 'urban-sketch',
  'engraving', 'game-show', 'silkscreen-poster', 'one-line'];
async function loadTiles() {
  const imgs = await Promise.all(SLUGS.map(async s => { const im = new Image(); im.src = `/docs/frames/${s}.jpg`; try { await im.decode(); return [s, im]; } catch { return null; } }));
  for (const it of imgs) { if (!it) continue; const [s, im] = it; const c = mk(320, 180), g = c.getContext('2d');
    g.drawImage(im, 0, 0, 320, 180);
    const lab = s.replace(/-/g, ' '); setFont(g, 17, 600, FAM.ui); const w = g.measureText(lab).width + 20;
    rr(g, 10, 180 - 38, w, 28, 14); g.fillStyle = 'rgba(16,20,28,.78)'; g.fill(); g.fillStyle = TXT; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(lab, 20, 180 - 23.5);
    TILES.push(c); }
}

// ---------- the FOLDLINE strip, folding in 3D (accordion of N panels) ----------
function drawStrip(g, cx, cy, sc, angle, alpha = 1) {
  const N = 8, PW = SW / N, F = 1700, COLS = 10;
  const xs = [0], zs = [0];
  for (let i = 0; i < N; i++) { const a = angle(i); xs.push(xs[i] + PW * Math.cos(a)); zs.push(zs[i] + (i % 2 ? -1 : 1) * PW * Math.sin(a)); }
  const tot = xs[N], zm = Math.max(...zs) / 2, P = z => F / (F + (z - zm) * 1.0);
  const X = (x, z) => cx + (x - tot / 2) * sc * P(z), Hh = z => SH * sc * P(z);
  g.save(); g.globalAlpha *= alpha;
  // soft shadow under the strip
  const sw = tot * sc * .52 + 40; const sg = g.createRadialGradient(cx, cy + SH * sc * .62, 10, cx, cy + SH * sc * .62, sw);
  sg.addColorStop(0, 'rgba(0,0,0,.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.save(); g.translate(cx, cy + SH * sc * .62); g.scale(1, .12); g.translate(-cx, -(cy + SH * sc * .62)); g.fillRect(cx - sw, cy + SH * sc * .62 - sw, sw * 2, sw * 2); g.restore();
  for (let i = 0; i < N; i++) {
    const a = angle(i), sn = Math.sin(a);
    for (let c = 0; c < COLS; c++) {
      const u0 = c / COLS, u1 = (c + 1) / COLS, xa = lerp(xs[i], xs[i + 1], u0), xb = lerp(xs[i], xs[i + 1], u1), za = lerp(zs[i], zs[i + 1], u0), zb = lerp(zs[i], zs[i + 1], u1);
      const X0 = X(xa, za), X1 = X(xb, zb), hh = (Hh(za) + Hh(zb)) / 2;
      if (X1 - X0 < .05) continue;
      g.drawImage(STRIP, i * PW + u0 * PW, 0, PW / COLS, SH, X0, cy - hh / 2, X1 - X0 + .7, hh);
    }
    // shading: panels that face away get darker
    const x0 = X(xs[i], zs[i]), x1 = X(xs[i + 1], zs[i + 1]), h0 = Hh(zs[i]), h1 = Hh(zs[i + 1]);
    g.beginPath(); g.moveTo(x0, cy - h0 / 2); g.lineTo(x1, cy - h1 / 2); g.lineTo(x1, cy + h1 / 2); g.lineTo(x0, cy + h0 / 2); g.closePath();
    const away = i % 2 === 0 ? 1 : 0, sh = Math.abs(sn);
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    if (away) { gr.addColorStop(0, `rgba(20,16,10,${.12 * sh})`); gr.addColorStop(1, `rgba(20,16,10,${.55 * sh})`); }
    else { gr.addColorStop(0, `rgba(20,16,10,${.4 * sh})`); gr.addColorStop(1, `rgba(255,255,255,${.12 * sh})`); }
    g.fillStyle = gr; g.fill();
    if (i > 0) { g.beginPath(); g.moveTo(x0, cy - h0 / 2); g.lineTo(x0, cy + h0 / 2); g.strokeStyle = `rgba(60,45,25,${.08 + .25 * sh})`; g.lineWidth = 2; g.stroke(); }
  }
  g.restore();
}

// ---------- scenes: f(g, lt, d, id); lt = seconds from the line start ----------
function tint(g, color, a) { const rg = g.createRadialGradient(W / 2, H * .45, 50, W / 2, H * .45, 1100); rg.addColorStop(0, color.replace('A', a)); rg.addColorStop(1, color.replace('A', 0)); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
function heading(g, lt, t0, s, o = {}) {
  fadeUp(g, seg(lt, t0, t0 + .5), 24, () => {
    let x = 100; if (o.tag) { x += pill(g, 100, 150, o.tag, { size: 30, bg: o.tagBg || TEAL, weight: 700 }) + 22; }
    text(g, s, x, 150, { size: 54, weight: 700, base: 'middle', color: TXT, maxW: 1100 });
  });
}

// 1. Title
function s01(g, lt, d, id) {
  const t0 = -0.6;
  const ang = i => { const u = seg(lt, t0 + i * .11, t0 + i * .11 + 1.05); return (82 * Math.PI / 180) * (1 - back(u, 1.25)); };
  const fl = Math.sin(lt * 1.1) * 6;
  drawStrip(g, 960, 420 + fl, 1, ang);
  const parts = [['Code in.', TXT, wt(id, 'turns', .29)], ['Video out.', TXT, wt(id, 'finished', .57)], ['Fast, on your Mac.', YEL, wt(id, 'fast', .64)]];
  const size = 58, gap = 26; const ws = parts.map(p => tw(g, p[0], size)); const tot = ws.reduce((a, b) => a + b, 0) + gap * 2;
  let x = 960 - tot / 2;
  parts.forEach((p, i) => { const px = x; fadeUp(g, seg(lt, p[2] - .1, p[2] + .45), 28, () => text(g, p[0], px, 712, { size, color: p[1], base: 'middle' })); x += ws[i] + gap; });
  // underline that draws itself after the tagline
  const ul = eo(seg(lt, parts[2][2] + .3, parts[2][2] + 1.1));
  if (ul > 0) { g.save(); g.strokeStyle = TEAL; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(960 - tot / 2 * ul, 768); g.lineTo(960 + tot / 2 * ul, 768); g.stroke(); g.restore(); }
}

// 2. Code on the left, the canvas it draws on the right; then a live edit
const CODE = [
  [['function', 'k'], [' render', 'f'], ['(t) {', 'p']],
  [['  g.', 'p'], ['fillStyle', 'f'], [' = ', 'p'], ["'#1b3a5c'", 's'], [';', 'p']],
  [['  g.', 'p'], ['fillRect', 'f'], ['(', 'p'], ['0', 'n'], [', ', 'p'], ['0', 'n'], [', ', 'p'], ['800', 'n'], [', ', 'p'], ['600', 'n'], [');', 'p']],
  [['  g.', 'p'], ['fillStyle', 'f'], [' = ', 'p'], ["'#ffd166'", 's'], [';', 'p']],
  [['  const', 'k'], [' y = ', 'p'], ['170', 'n'], [' + ', 'p'], ['20', 'n'], [' * Math.', 'p'], ['sin', 'f'], ['(t);', 'p']],
  [['  g.', 'p'], ['beginPath', 'f'], ['();', 'p']],
  [['  g.', 'p'], ['arc', 'f'], ['(', 'p'], ['600', 'n'], [', y, ', 'p'], ['70', 'n', 'R'], [', ', 'p'], ['0', 'n'], [', Math.PI * ', 'p'], ['2', 'n'], [');', 'p']],
  [['  g.', 'p'], ['fill', 'f'], ['();', 'p']],
  [['  g.', 'p'], ['fillStyle', 'f'], [' = ', 'p'], ["'#2ec4a6'", 's'], [';', 'p']],
  [['  g.', 'p'], ['fillRect', 'f'], ['(', 'p'], ['0', 'n'], [', ', 'p'], ['440', 'n'], [', ', 'p'], ['800', 'n'], [', ', 'p'], ['160', 'n'], [');', 'p']],
  [['  g.', 'p'], ['fillStyle', 'f'], [' = ', 'p'], ["'", 's'], ['#ff6a3d', 's', 'C'], ["'", 's'], [';', 'p']],
  [['  g.', 'p'], ['fillRect', 'f'], ['(', 'p'], ['180', 'n'], [', ', 'p'], ['300', 'n'], [', ', 'p'], ['200', 'n'], [', ', 'p'], ['140', 'n'], [');', 'p']],
  [['}', 'p']],
];
const CODEC = { k: '#c792ea', f: '#82aaff', s: '#c3e88d', n: '#f78c6c', p: '#e6e1d6' };
const LINE_LEN = CODE.map(l => l.reduce((a, t) => a + t[0].length, 0));
const LINE_END = []; LINE_LEN.reduce((a, n, i) => (LINE_END[i] = a + n, a + n), 0);
const NCH = LINE_END[LINE_END.length - 1];
function s02(g, lt, d, id) {
  const T0 = -0.05, T1 = 0.42 * d, typed = Math.floor(NCH * seg(lt, T0, T1));
  const lineDone = i => T0 + LINE_END[i] / NCH * (T1 - T0);
  const E1 = 0.45 * d, E2 = 0.56 * d;   // edit 1: radius 70 -> 110, edit 2: house colour
  const edit = (tok, tE, from, to) => {
    if (lt < tE + .32) return { s: from, sel: seg(lt, tE, tE + .25) };
    return { s: to.slice(0, Math.ceil(to.length * seg(lt, tE + .32, tE + .32 + .05 * to.length))), sel: 0 };
  };
  const eR = edit('R', E1, '70', '110'), eC = edit('C', E2, '#ff6a3d', '#9b5de5');
  // editor panel
  const ex = 100, ey = 110, ew = 860, eh = 640;
  rr(g, ex, ey, ew, eh, 22); shadowFill(g, '#151a24', 50, 18, .5);
  rr(g, ex, ey, ew, 56, [22, 22, 0, 0]); g.fillStyle = '#1e2532'; g.fill();
  [CORAL, YEL, TEAL].forEach((c, i) => { g.beginPath(); g.arc(ex + 32 + i * 28, ey + 28, 8, 0, TAU); g.fillStyle = c; g.fill(); });
  text(g, 'scene.js', ex + ew / 2, ey + 29, { size: 24, color: DIM, align: 'center', base: 'middle', weight: 500 });
  const lh = 38, cx0 = ex + 86, cy0 = ey + 100, cw = tw(g, 'M', 24, { fam: 'mono' });
  // current line highlight + caret
  let caretL = 0, caretC = 0, n = typed;
  for (let i = 0; i < CODE.length; i++) { if (n <= LINE_LEN[i]) { caretL = i; caretC = n; break; } n -= LINE_LEN[i]; caretL = i; caretC = LINE_LEN[i]; }
  let editing = null;
  if (lt > E1 - .3 && lt < E1 + .9) editing = { line: 6, tok: 'R', e: eR }; else if (lt > E2 - .3 && lt < E2 + 1.0) editing = { line: 10, tok: 'C', e: eC };
  if (editing) caretL = editing.line;
  g.fillStyle = 'rgba(255,255,255,.045)'; g.fillRect(ex + 4, cy0 + caretL * lh - lh * .68, ew - 8, lh);
  let count = 0;
  for (let i = 0; i < CODE.length; i++) {
    const y = cy0 + i * lh;
    if (count >= typed && i > caretL) break;
    text(g, String(i + 1), cx0 - 22, y, { fam: 'mono', size: 20, color: '#4b5568', align: 'right' });
    let x = cx0;
    for (const [s0, ty, key] of CODE[i]) {
      let s = s0, sel = 0;
      if (key === 'R') { s = eR.s; sel = eR.sel; } if (key === 'C') { s = eC.s; sel = eC.sel; }
      const left = typed - count; const shown = key ? (left >= s0.length ? s : s0.slice(0, Math.max(0, left))) : s0.slice(0, Math.max(0, left));
      count += s0.length;
      if (sel > 0) { g.fillStyle = `rgba(255,209,102,${.35 * sel})`; g.fillRect(x - 2, y - 26, cw * s.length + 4, 34); }
      if (shown) text(g, shown, x, y, { fam: 'mono', size: 24, color: CODEC[ty] });
      if (editing && key === editing.tok) { const cxp = x + cw * shown.length; if ((lt * 2.2) % 1 < .6) { g.fillStyle = YEL; g.fillRect(cxp + 1, y - 24, 3, 30); } }
      x += cw * shown.length;
    }
  }
  if (!editing && (typed < NCH || (lt * 2.2) % 1 < .6)) { const y = cy0 + caretL * lh; g.fillStyle = YEL; g.fillRect(cx0 + caretC * cw + 1, y - 24, 3, 30); }
  // canvas panel
  const px = 1000, py = 110, pw = 820, ph = 640;
  rr(g, px, py, pw, ph, 22); shadowFill(g, '#151a24', 50, 18, .5);
  rr(g, px, py, pw, 56, [22, 22, 0, 0]); g.fillStyle = '#1e2532'; g.fill();
  const tt = Math.max(0, lt + .45);
  text(g, 'canvas  800 × 600', px + 26, py + 29, { size: 24, color: DIM, base: 'middle', weight: 500 });
  text(g, `t = ${tt.toFixed(2)} s`, px + pw - 26, py + 29, { fam: 'mono', size: 22, color: TEAL, align: 'right', base: 'middle' });
  const sc = Math.min(780 / 800, (ph - 56 - 40) / 600), vw = 800 * sc, vh = 600 * sc, vx = px + (pw - vw) / 2, vy = py + 56 + 20;
  g.save(); rr(g, vx, vy, vw, vh, 10); g.clip();
  g.fillStyle = '#0c1017'; g.fillRect(vx, vy, vw, vh);
  g.fillStyle = 'rgba(255,255,255,.03)'; for (let yy = 0; yy < 600; yy += 40) for (let xx = (yy / 40) % 2 * 40; xx < 800; xx += 80) g.fillRect(vx + xx * sc, vy + yy * sc, 40 * sc, 40 * sc);
  g.translate(vx, vy); g.scale(sc, sc);
  const pSky = eo(seg(lt, lineDone(2), lineDone(2) + .35));
  if (pSky > 0) { g.fillStyle = '#1b3a5c'; g.fillRect(0, 0, 800 * pSky, 600 * Math.min(1, pSky * 1.4)); }
  const sunR = lerp(70, 110, back(seg(lt, E1 + .5, E1 + .9), 2.2)), sunY = 170 + 20 * Math.sin(tt);
  const pArc = eo(seg(lt, lineDone(6), lineDone(6) + .4)), pFill = seg(lt, lineDone(7), lineDone(7) + .25);
  if (pArc > 0) { g.beginPath(); g.arc(600, sunY, sunR, -Math.PI / 2, -Math.PI / 2 + TAU * pArc); g.strokeStyle = YEL; g.lineWidth = 6; g.stroke(); }
  if (pFill > 0) { g.globalAlpha = pFill; g.beginPath(); g.arc(600, sunY, sunR, 0, TAU); g.fillStyle = YEL; g.fill(); g.globalAlpha = 1; }
  const pG = eo(seg(lt, lineDone(9), lineDone(9) + .4)); if (pG > 0) { g.fillStyle = TEAL; g.fillRect(0, 440, 800 * pG, 160); }
  const pH = back(seg(lt, lineDone(11), lineDone(11) + .45));
  if (pH > 0) { const hc = seg(lt, E2 + .32 + .05 * 7, E2 + .32 + .05 * 7 + .3); g.fillStyle = hc > 0 ? mixHex(CORAL, '#9b5de5', hc) : CORAL; g.fillRect(180, 440 - 140 * pH, 200, 140 * pH); }
  g.restore();
  // "updated" flash on each edit
  for (const tE of [E1 + .5, E2 + .7]) { const f = seg(lt, tE, tE + .25) * (1 - seg(lt, tE + .9, tE + 1.2)); if (f > 0) pop(g, px + pw - 90, py + 100, f, () => pill(g, px + pw - 90, py + 100, 'updated', { size: 24, bg: TEAL, align: 'center', weight: 700 }), .7); }
  // stamps under the panels
  const st = [[wt(id, 'no', .68, 0), 'No video generation', 530, -5], [wt(id, 'no', .84, 1), 'No stock footage', 1410, 4]];
  for (const [t0, s, x, rot] of st) {
    const p = seg(lt, t0 - .05, t0 + .3); if (p <= 0) continue;
    g.save(); g.translate(x, 818); g.rotate(rot * Math.PI / 180); const sc2 = lerp(1.5, 1, eo(p)); g.scale(sc2, sc2); g.globalAlpha = clamp(p * 2.5);
    const w = tw(g, s, 46, { fam: 'big' }) + 60; rr(g, -w / 2, -38, w, 76, 14); g.fillStyle = 'rgba(16,20,28,.92)'; g.fill(); g.strokeStyle = CORAL; g.lineWidth = 5; g.stroke();
    text(g, s, 0, 2, { fam: 'big', size: 46, color: CORAL, align: 'center', base: 'middle' }); g.restore();
  }
}
function mixHex(a, b, u) { const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], u))).join(',')})`; }

// 3. The slow pipeline
const BOX = { x0: 100, w: 236, gap: (1720 - 6 * 236) / 5, y: 420, h: 214 };
const boxX = k => BOX.x0 + k * (BOX.w + BOX.gap);
const OLD = [['Canvas', icCanvas], ['Screenshot', icCamera], ['JPEG', (g, x, y, s, c) => icFile(g, x, y, s, c, 'JPG')], ['Pipe', icPipe], ['Decode', icDecode], ['Software encode', icGear]];
function oldBox(g, k, lit, done, lt) {
  const x = boxX(k), y = BOX.y, w = BOX.w, h = BOX.h;
  const col = lit > 0 ? mixHex('#3a4356', CORAL, lit) : '#3a4356';
  glass(g, x, y, w, h, 24);
  if (lit > 0) { g.save(); g.shadowColor = CORAL; g.shadowBlur = 34 * lit * (done ? .5 : 1); rr(g, x, y, w, h, 24); g.strokeStyle = col; g.lineWidth = 4; g.stroke(); g.restore(); }
  else { rr(g, x, y, w, h, 24); g.strokeStyle = col; g.lineWidth = 3; g.stroke(); }
  const ic = lit > 0 ? mixHex('#7d879b', done ? '#ffb38f' : CORAL, lit) : '#7d879b';
  if (k === 5) icGear(g, x + w / 2, y + 74, 86, ic, lit > 0 ? lt * .5 : 0); else OLD[k][1](g, x + w / 2, y + 74, 86, ic);
  const lab = OLD[k][0], lc = lit > 0 ? TXT : DIM;
  if (k === 5) { text(g, 'Software', x + w / 2, y + 152, { size: 30, color: lc, align: 'center', base: 'middle' }); text(g, 'encode', x + w / 2, y + 186, { size: 30, color: lc, align: 'center', base: 'middle' }); }
  else text(g, lab, x + w / 2, y + 166, { size: 30, color: lc, align: 'center', base: 'middle', maxW: w - 24 });
}
function frameCard(g, cx, cy, w, img, o = {}) {
  const h = w * .625; g.save(); g.translate(cx, cy); if (o.rot) g.rotate(o.rot); g.scale(o.sx || 1, o.sy || 1);
  rr(g, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 10); shadowFill(g, CARD, 20, 8, .5);
  g.save(); rr(g, -w / 2, -h / 2, w, h, 6); g.clip(); g.imageSmoothingEnabled = !o.pix; g.drawImage(img, -w / 2, -h / 2, w, h);
  if (o.flash) { g.fillStyle = `rgba(255,255,255,${o.flash})`; g.fillRect(-w / 2, -h / 2, w, h); } g.restore();
  g.restore();
}
function s03(g, lt, d, id) {
  tint(g, 'rgba(255,106,61,A)', .10);
  heading(g, lt, -0.4, 'The usual way', { tag: 'slow', tagBg: CORAL });
  // slow clock (ticks once a second)
  const k = Math.floor(lt + .45), f = lt + .45 - k, ang = (k + eo(seg(f, 0, .22))) / 12 * TAU;
  stopwatch(g, 1760, 165, 54, ang, CORAL);
  text(g, `0:${String(Math.max(0, k)).padStart(2, '0')}`, 1676, 168, { fam: 'mono', size: 34, color: CORAL, align: 'right', base: 'middle' });
  const L = [wt(id, 'each', .36), wt(id, 'screenshot', .48), wt(id, 'jpeg', .64), wt(id, 'piped', .68), wt(id, 'decoded', .76), wt(id, 'encoded', .88)];
  for (let i = 1; i < 6; i++) if (L[i] < L[i - 1] + .25) L[i] = L[i - 1] + .25;
  for (let i = 0; i < 6; i++) {
    const app = seg(lt, -0.45 + i * .08, -0.05 + i * .08), lit = eo(seg(lt, L[i] - .05, L[i] + .3)), done = lt > L[i] + .6 && i < 5;
    pop(g, boxX(i) + BOX.w / 2, BOX.y + BOX.h / 2, app, () => oldBox(g, i, lit, done, lt), .85);
    if (i < 5) { const ax = boxX(i) + BOX.w + 12, bx = boxX(i + 1) - 12, ay = BOX.y + BOX.h / 2, on = seg(lt, L[i + 1] - .5, L[i + 1]);
      arrow(g, ax, ay, bx, ay, on > 0 ? mixHex('#3a4356', CORAL, on) : '#3a4356', 5, app, 14); }
  }
  // the frame card crawling along above the boxes
  const cxs = [0, 1, 2, 3, 4, 5].map(i => boxX(i) + BOX.w / 2);
  if (lt > L[0] - .1) {
    let x = cxs[0], stage = 0;
    for (let i = 0; i < 5; i++) { if (lt >= L[i]) { stage = i; const m0 = Math.max(L[i] + .15, L[i + 1] - .7); x = lerp(cxs[i], cxs[i + 1], eio(seg(lt, m0, L[i + 1]))); } }
    if (lt >= L[5]) { stage = 5; x = cxs[5]; }
    const img = lt >= L[4] + .1 ? PIX2 : lt >= L[2] + .1 ? PIX1 : MINI, flash = lt > L[1] - .05 ? 1 - seg(lt, L[1], L[1] + .4) : 0;
    const squish = 1 - .5 * Math.sin(Math.PI * seg(lt, L[3] - .45, L[3] + .45));
    const app = back(seg(lt, L[0] - .1, L[0] + .35));
    const wob = Math.sin(lt * 5) * .03 * (lt > L[0] + .3 ? 1 : 0);
    g.save(); g.globalAlpha = clamp(app * 2); frameCard(g, x, 330 + Math.sin(lt * 3) * 4, 132 * app, img, { pix: img !== MINI, flash: flash > 0 && flash < 1 ? flash : 0, sy: squish, rot: wob }); g.restore();
    // frames waiting in line on the left
    const nq = Math.min(5, Math.floor(Math.max(0, lt - L[0] - .6) * 1.1));
    for (let q = 0; q < nq; q++) { const pq = seg(lt, L[0] + .6 + q / 1.1, L[0] + .6 + q / 1.1 + .35); g.save(); g.globalAlpha = .55 * clamp(pq * 2); frameCard(g, cxs[0] - 4 + q * 7, 718 + q * 8 - 6 * (1 - eo(pq)), 92, MINI, { rot: (q % 2 ? 1 : -1) * .04 }); g.restore(); }
    if (nq > 0) fadeUp(g, seg(lt, L[0] + .7, L[0] + 1.1), 10, () => text(g, 'frames waiting', cxs[0] + 90, 735, { size: 28, color: DIM, base: 'middle' }));
  }
}

// 4. Timing: where one frame's time goes
function stripes(g, x, y, w, h, lt, a = .12, sp = 60) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = `rgba(255,255,255,${a})`;
  const off = (lt * 70) % sp; for (let xx = -sp * 2 - h; xx < w + sp; xx += sp) { g.beginPath(); g.moveTo(x + xx + off, y + h); g.lineTo(x + xx + off + sp / 2, y + h); g.lineTo(x + xx + off + sp / 2 + h * .6, y); g.lineTo(x + xx + off + h * .6, y); g.closePath(); g.fill(); }
  g.restore();
}
function legend(g, xr, y, items, size = 26) {   // right-aligned row of ● label
  let x = xr; for (let i = items.length - 1; i >= 0; i--) { const [lab, col] = items[i]; const w = tw(g, lab, size, { weight: 600 }); x -= w; text(g, lab, x, y, { size, weight: 600, color: DIM, base: 'middle' }); x -= 30; rr(g, x, y - 9, 18, 18, 5); g.fillStyle = col; g.fill(); x -= 28; }
}
function s04(g, lt, d, id) {
  tint(g, 'rgba(255,106,61,A)', .06);
  const tD = wt(id, 'drawing', .17), tF = wt(id, ['four', '4'], .44), tM = wt(id, 'moving', .56), tMost = wt(id, 'most', .78);
  const cx = 100, cy = 110, cw = 1720, ch = 750;
  glass(g, cx, cy, cw, ch, 32);
  stopwatch(g, 168, 186, 30, lt * (lt > tM ? 4 : 1.2), lt > tM ? CORAL : TEAL);
  text(g, 'Where one frame’s time goes', 222, 176, { size: 44, weight: 700, base: 'middle' });
  text(g, 'the usual way, timed', 222, 220, { size: 26, color: DIM, base: 'middle' });
  legend(g, cx + cw - 40, 186, [['Draw', TEAL], ['Moving pixels', CORAL]]);
  const bx = 160, by = 350, bw = 1600, bh = 110;
  rr(g, bx, by, bw, bh, 24); g.fillStyle = 'rgba(8,11,16,.6)'; g.fill(); rr(g, bx, by, bw, bh, 24); g.strokeStyle = LINEC; g.lineWidth = 2; g.stroke();
  const dw = 64 * eo(seg(lt, tD, tD + .5)), mw = (bw - 68) * eio(seg(lt, tM, tM + 1.6));
  g.save(); rr(g, bx, by, bw, bh, 24); g.clip();
  if (dw > 0) { g.fillStyle = TEAL; g.fillRect(bx, by, dw, bh); }
  if (mw > 0) { const gr = g.createLinearGradient(0, by, 0, by + bh); gr.addColorStop(0, '#ff7f57'); gr.addColorStop(1, '#f2582c'); g.fillStyle = gr; g.fillRect(bx + 68, by, mw, bh); stripes(g, bx + 68, by, mw, bh, lt, .1); }
  g.restore();
  if (mw > 520) { g.save(); g.globalAlpha = seg(mw, 520, 760); text(g, 'Moving pixels', bx + 68 + mw / 2, by + bh / 2 + 3, { fam: 'big', size: 60, color: INK, align: 'center', base: 'middle' }); g.restore(); }
  // callout for the draw segment
  pop(g, bx + 32, 300, seg(lt, tD + .15, tD + .55), () => {
    const val = Math.round(4 * eo(seg(lt, tF - .2, tF + .4)));
    rr(g, bx, 262, 250, 64, 18); shadowFill(g, CARD, 20, 6, .4);
    text(g, 'Draw', bx + 22, 295, { size: 34, weight: 700, color: INK, base: 'middle' });
    text(g, `${val} ms`, bx + 228, 295, { fam: 'big', size: 44, color: '#138f77', align: 'right', base: 'middle' });
    g.beginPath(); g.moveTo(bx + 32, 326); g.lineTo(bx + 32, by - 4); g.strokeStyle = CARD; g.lineWidth = 3; g.stroke();
  }, .7);
  // bracket under the moving part, with the steps it is made of
  const pb = eo(seg(lt, tM + .5, tM + 1.1));
  if (pb > 0) {
    const x0 = bx + 68, x1 = bx + bw, yb = by + bh + 22, xm = (x0 + x1) / 2, hw = (x1 - x0) / 2 * pb;
    g.save(); g.strokeStyle = 'rgba(255,106,61,.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(xm - hw, yb); g.lineTo(xm - hw, yb + 14); g.lineTo(xm + hw, yb + 14); g.lineTo(xm + hw, yb); g.moveTo(xm, yb + 14); g.lineTo(xm, yb + 30); g.stroke(); g.restore();
    const steps = [['Screenshot', icCamera], ['JPEG', (g2, x, y, s, c) => icFile(g2, x, y, s, c, 'JPG')], ['Pipe', icPipe], ['Decode', icDecode], ['Encode', icGear]];
    const sw = 250, sg = 24, sx0 = xm - (5 * sw + 4 * sg) / 2;
    steps.forEach(([lab, ic], i) => {
      const p = seg(lt, tM + .7 + i * .1, tM + 1.1 + i * .1); const x = sx0 + i * (sw + sg);
      pop(g, x + sw / 2, 548, p, () => { rr(g, x, 518, sw, 62, 31); g.fillStyle = 'rgba(255,106,61,.12)'; g.fill(); g.strokeStyle = 'rgba(255,106,61,.45)'; g.lineWidth = 2; g.stroke();
        ic(g, x + 40, 549, 36, CORAL); text(g, lab, x + 72, 550, { size: 28, weight: 600, color: TXT, base: 'middle', maxW: sw - 90 }); }, .7);
    });
  }
  // two stat tiles
  const tile = (x, p, col, k1, big, k2) => fadeUp(g, p, 24, () => {
    rr(g, x, 640, 780, 170, 26); g.fillStyle = col === TEAL ? 'rgba(46,196,166,.09)' : 'rgba(255,106,61,.09)'; g.fill(); g.strokeStyle = col === TEAL ? 'rgba(46,196,166,.45)' : 'rgba(255,106,61,.45)'; g.lineWidth = 2; g.stroke();
    rr(g, x, 640, 12, 170, [26, 0, 0, 26]); g.fillStyle = col; g.fill();
    text(g, k1, x + 44, 688, { size: 30, weight: 600, color: DIM, base: 'middle' });
    text(g, big, x + 44, 756, { fam: 'big', size: 66, color: col, base: 'middle', maxW: 700 });
    if (k2) text(g, k2, x + 736, 756, { size: 30, weight: 600, color: DIM, align: 'right', base: 'middle' });
  });
  tile(160, seg(lt, tF + .2, tF + .7), TEAL, 'Drawing a frame', `${Math.round(4 * eo(seg(lt, tF + .2, tF + .8)))} ms`, 'the fast part');
  tile(980, seg(lt, tMost - .1, tMost + .4), CORAL, 'Moving it around', 'most of the time', '');
}

// 5. The fast pipeline
function chip(g, cx, cy, s, glow, lt) {
  g.save();
  const pins = 7; g.fillStyle = '#8fa3a8';
  for (let i = 0; i < pins; i++) { const o = -s / 2 + s * (i + .5) / pins * .86 + s * .07; rr(g, cx + o - 7, cy - s / 2 - 26, 14, 30, 4); g.fill(); rr(g, cx + o - 7, cy + s / 2 - 4, 14, 30, 4); g.fill(); rr(g, cx - s / 2 - 26, cy + o - 7, 30, 14, 4); g.fill(); rr(g, cx + s / 2 - 4, cy + o - 7, 30, 14, 4); g.fill(); }
  g.shadowColor = TEAL; g.shadowBlur = 30 + 30 * glow; rr(g, cx - s / 2, cy - s / 2, s, s, 30); g.fillStyle = '#16302f'; g.fill(); g.shadowBlur = 0;
  rr(g, cx - s / 2, cy - s / 2, s, s, 30); g.strokeStyle = TEAL; g.lineWidth = 5; g.stroke();
  rr(g, cx - s * .34, cy - s * .34, s * .68, s * .68, 18); g.strokeStyle = 'rgba(46,196,166,.45)'; g.lineWidth = 3; g.stroke();
  text(g, 'GPU', cx, cy - s * .07, { fam: 'big', size: s * .27, color: TEAL, align: 'center', base: 'middle' });
  text(g, 'VideoToolbox', cx, cy + s * .18, { size: s * .1, weight: 600, color: TXT, align: 'center', base: 'middle', maxW: s * .62 });
  g.restore();
}
function s05(g, lt, d, id) {
  // the old boxes fold away first
  for (let i = 0; i < 6; i++) {
    const p = eio(seg(lt, .12 + i * .08, .55 + i * .08)); if (p >= 1) continue;
    const cy = BOX.y + BOX.h / 2; g.save(); g.globalAlpha = 1 - seg(p, .6, 1); g.translate(0, cy + p * 40); g.scale(1, Math.cos(p * Math.PI / 2)); g.translate(0, -cy);
    oldBox(g, i, 1, i < 5, lt); g.fillStyle = `rgba(0,0,0,${.6 * p})`; rr(g, boxX(i), BOX.y, BOX.w, BOX.h, 24); g.fill(); g.restore();
  }
  const tA = Math.min(.6, .1 * d), tH = wt(id, 'hands', .29), tN = wt(id, 'never', .79), tE = wt(id, 'hardware', .58);
  tint(g, 'rgba(46,196,166,A)', .12 * seg(lt, tA - .3, tA + .5));
  heading(g, lt, -0.3, 'skips all of that', { tag: 'Foldline' });
  const cy = 480, ax = 330, chx = 960, mx = 1590;
  // tubes
  const pt = eo(seg(lt, tA + .2, tA + .8));
  if (pt > 0) { g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(46,196,166,.25)'; g.lineWidth = 34;
    g.beginPath(); g.moveTo(ax + 130, cy); g.lineTo(lerp(ax + 130, chx - 150, pt), cy); g.stroke();
    g.beginPath(); g.moveTo(chx + 150, cy); g.lineTo(lerp(chx + 150, mx - 110, pt), cy); g.stroke(); g.restore(); }
  // frames zipping through, about 14 a second
  if (lt > tH) {
    const rate = 14, life = .8, kMin = Math.max(0, Math.floor((lt - tH - life) * rate)), kMax = Math.floor((lt - tH) * rate);
    for (let k = kMin; k <= kMax; k++) {
      const u = (lt - tH - k / rate) / life; if (u < 0 || u > 1) continue;
      const x = lerp(ax, mx, u); if (Math.abs(x - chx) < 140) continue;
      const a = Math.min(1, seg(u, 0, .08) * 1, 1 - seg(u, .93, 1));
      g.save(); g.globalAlpha = a;
      g.fillStyle = 'rgba(46,196,166,.35)'; rr(g, x - 90, cy - 16, 70, 32, 16); g.fill();
      frameCard(g, x, cy, 64, MINI); g.restore();
    }
  }
  pop(g, ax, cy, seg(lt, tA, tA + .45), () => {
    glass(g, ax - 130, cy - 100, 260, 200, 26); rr(g, ax - 130, cy - 100, 260, 200, 26); g.strokeStyle = TEAL; g.lineWidth = 4; g.stroke();
    icCanvas(g, ax, cy - 22, 96, TEAL); text(g, 'Canvas', ax, cy + 62, { size: 32, align: 'center', base: 'middle' });
  });
  pop(g, chx, cy, seg(lt, tA + .15, tA + .6), () => chip(g, chx, cy, 250, .5 + .5 * Math.sin(lt * 9), lt));
  fadeUp(g, seg(lt, tE - .1, tE + .4), 14, () => text(g, 'Hardware video encoder', chx, cy + 196, { size: 34, weight: 700, color: TXT, align: 'center', base: 'middle' }));
  pop(g, mx, cy, seg(lt, tA + .3, tA + .75), () => {
    glass(g, mx - 110, cy - 110, 220, 220, 26); rr(g, mx - 110, cy - 110, 220, 220, 26); g.strokeStyle = TEAL; g.lineWidth = 4; g.stroke();
    icFile(g, mx, cy - 18, 120, TEAL, 'MP4');
    const nf = lt > tH + .8 ? Math.floor((lt - tH - .8) * 14) + 1 : 0;
    text(g, `${nf.toLocaleString('en-US')} frames`, mx, cy + 72, { fam: 'mono', size: 24, color: TXT, align: 'center', base: 'middle' });
  });
  // the GPU boundary
  const pb = eo(seg(lt, tN - .2, tN + .5));
  if (pb > 0) {
    g.save(); g.globalAlpha = pb; rr(g, 150, cy - 220, 1000, 480, 34); g.setLineDash([18, 12]); g.lineDashOffset = -lt * 40; g.strokeStyle = TEAL; g.lineWidth = 4; g.stroke(); g.setLineDash([]);
    pill(g, 650, cy - 220, 'stays on the graphics chip', { size: 30, bg: TEAL, align: 'center', weight: 700 }); g.restore();
  }
}

// 6. 83 s Short: build-time race on a real axis, RAM panel, 2x
function phone(g, x, y, w, h, lt) {
  rr(g, x - 12, y - 12, w + 24, h + 24, 48); shadowFill(g, '#2a3242', 40, 16, .5);
  rr(g, x - 12, y - 12, w + 24, h + 24, 48); g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; g.stroke();
  g.save(); rr(g, x, y, w, h, 38); g.clip();
  const sc = h / 540, sw = 960 * sc; g.drawImage(LOOK.paper, x + w / 2 - sw * .36 + Math.sin(lt * .6) * 10, y, sw, h);
  const p = (lt * .18) % 1; g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + h - 10, w, 10); g.fillStyle = CORAL; g.fillRect(x, y + h - 10, w * p, 10);
  g.restore();
  rr(g, x + w / 2 - 46, y + 12, 92, 20, 10); g.fillStyle = '#0b0e14'; g.fill();
}
function hbar(g, x, y, w, h, col, lt, striped = true) {
  if (w <= 0) return; g.save(); rr(g, x, y, Math.max(h, w), h, h / 2); g.clip();
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, mixHex(col, '#ffffff', .12)); gr.addColorStop(1, col); g.fillStyle = gr; g.fillRect(x, y, Math.max(h, w), h);
  if (striped) stripes(g, x, y, Math.max(h, w), h, lt, .12, 50); g.restore();
}
function s06(g, lt, d, id) {
  const Rs = Math.max(.4, wt(id, 'used', .25) - .3), Re = Math.max(Rs + 2.2, Math.min(d - .3, wt(id, 'now', .69)));
  const t3 = Math.max(Re - .1, wt(id, ['thirty', '30'], .9));
  phone(g, 128, 180, 250, 500, lt);
  pill(g, 253, 760, '83 s Short', { fam: 'big', size: 40, bg: YEL, align: 'center' });
  // chart card
  const cx = 450, cy = 110, cw = 1370, ch = 520;
  glass(g, cx, cy, cw, ch, 30);
  text(g, 'Build time', cx + 40, cy + 58, { size: 44, weight: 700, base: 'middle' });
  text(g, 'seconds to build the 83 s Short', cx + 40, cy + 102, { size: 26, color: DIM, base: 'middle' });
  legend(g, cx + cw - 40, cy + 58, [['Before', CORAL], ['Foldline', TEAL]]);
  const ax0 = 700, ax1 = 1760, ay0 = 250, ay1 = 520, X = s => ax0 + (ax1 - ax0) * s / 60;
  for (let s = 0; s <= 60; s += 10) { g.beginPath(); g.moveTo(X(s) + .5, ay0); g.lineTo(X(s) + .5, ay1); g.strokeStyle = s ? 'rgba(243,239,230,.07)' : 'rgba(243,239,230,.25)'; g.lineWidth = s ? 1 : 2; g.stroke();
    text(g, s === 60 ? '60 s' : String(s), X(s), ay1 + 30, { size: 24, color: DIM, align: s === 60 ? 'right' : 'center', base: 'middle' }); }
  const u = clamp((lt - Rs) / (Re - Rs)), uf = clamp(u * 2);
  const rows = [['Before', CORAL, 60 * u, u, 290, Re], ['Foldline', TEAL, 30 * uf, uf, 410, (Rs + Re) / 2]];
  for (const [name, col, val, p, y, tDone] of rows) {
    const h = 76; text(g, name, cx + 40, y + h / 2, { size: 38, weight: 700, color: col, base: 'middle' });
    rr(g, ax0, y, ax1 - ax0, h, h / 2); g.fillStyle = 'rgba(8,11,16,.45)'; g.fill();
    const w = X(val) - ax0; hbar(g, ax0, y, w, h, col, lt, p < 1);
    const lab = name === 'Foldline' && p >= 1 ? '~30 s' : `${Math.round(val)} s`, lw = tw(g, lab, 42, { fam: 'big' });
    if (w > lw + 70) text(g, lab, ax0 + w - (p >= 1 ? 80 : 24), y + h / 2 + 2, { fam: 'big', size: 42, color: INK, align: 'right', base: 'middle' });
    else if (p > 0) text(g, lab, ax0 + Math.max(w, h) + 16, y + h / 2 + 2, { fam: 'big', size: 42, color: col, base: 'middle' });
    if (p >= 1) checkMark(g, ax0 + w - 38, y + h / 2, 26, CARD, seg(lt, tDone, tDone + .4));
  }
  // RAM panel
  const pr = seg(lt, Re - .4, Re + .1);
  fadeUp(g, pr, 30, () => {
    const x = 450, y = 660, w = 660, h = 200; glass(g, x, y, w, h, 26);
    // memory stick icon
    rr(g, x + 36, y + 34, 54, 30, 5); g.strokeStyle = TEAL; g.lineWidth = 3; g.stroke(); for (let i = 0; i < 4; i++) { g.fillStyle = TEAL; g.fillRect(x + 42 + i * 12, y + 41, 7, 16); }
    text(g, 'Memory', x + 106, y + 50, { size: 32, weight: 700, base: 'middle' }); text(g, 'peak RAM', x + w - 30, y + 50, { size: 24, color: DIM, align: 'right', base: 'middle' });
    const mx0 = x + 190, mxw = 330;
    [['Before', CORAL, 2.2, y + 106], ['Foldline', TEAL, 1.4, y + 156]].forEach(([n, col, gb, yy], i) => {
      const p = eio(seg(lt, Re - .1 + i * .15, Re + .6 + i * .15));
      text(g, n, x + 36, yy, { size: 28, weight: 600, color: col, base: 'middle' });
      rr(g, mx0, yy - 14, mxw, 28, 14); g.fillStyle = 'rgba(8,11,16,.45)'; g.fill();
      hbar(g, mx0, yy - 14, mxw * gb / 2.5 * p, 28, col, lt, false);
      text(g, `${(gb * p).toFixed(1)} GB`, x + w - 30, yy + 1, { fam: 'big', size: 34, color: col, align: 'right', base: 'middle' });
    });
  });
  // multiplier card
  const pm = seg(lt, t3 - .15, t3 + .3);
  pop(g, 1480, 760, pm, () => {
    const x = 1140, y = 660, w = 680, h = 200; glass(g, x, y, w, h, 26, { stroke: 'rgba(255,209,102,.45)' });
    text(g, '2×', x + 40, y + h / 2 + 6, { fam: 'big', size: 150, color: YEL, base: 'middle' });
    text(g, 'faster build', x + 290, y + 78, { size: 44, weight: 700, base: 'middle' });
    text(g, '60 s to ~30 s', x + 290, y + 132, { size: 30, color: DIM, base: 'middle' });
  }, .6);
}

// 7. 8.4 min film: render-time column chart + CPU gauge
function s07(g, lt, d, id) {
  const tB = wt(id, 'went', .25) - .1, tF = wt(id, 'under', .47) - .1, tG = wt(id, ['three', '3'], .54), tS = wt(id, 'using', .62), tP = wt(id, ['percent', '%'], .78);
  // left card: render time
  const cx = 100, cy = 110, cw = 980, ch = 750;
  glass(g, cx, cy, cw, ch, 30);
  g.save(); rr(g, cx + 36, cy + 30, 168, 95, 12); g.clip(); g.drawImage(LOOK.neon, cx + 36 - 4 + Math.sin(lt * .5) * 4, cy + 30, 176, 99); g.restore();
  rr(g, cx + 36, cy + 30, 168, 95, 12); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.stroke();
  text(g, 'Render time', cx + 228, cy + 62, { size: 44, weight: 700, base: 'middle' });
  text(g, '8.4 min film', cx + 228, cy + 104, { size: 28, color: YEL, weight: 600, base: 'middle' });
  legend(g, cx + cw - 36, cy + 62, [['Before', CORAL], ['Foldline', TEAL]], 24);
  const px0 = 250, px1 = 1040, py0 = 300, py1 = 730, k = (py1 - py0) / 450;
  for (let s = 0; s <= 400; s += 100) { const y = py1 - s * k; g.beginPath(); g.moveTo(px0, y + .5); g.lineTo(px1, y + .5); g.strokeStyle = s ? 'rgba(243,239,230,.07)' : 'rgba(243,239,230,.25)'; g.lineWidth = s ? 1 : 2; g.stroke();
    text(g, `${s} s`, px0 - 16, y, { size: 22, color: DIM, align: 'right', base: 'middle' }); }
  const cols = [['Before', CORAL, 426, '7.1 min', 445, tB], ['Foldline', TEAL, 161, '2.7 min', 835, tF]];
  for (const [name, col, val, mins, x, t0] of cols) {
    const p = eio(seg(lt, t0, t0 + .8)), bw = 210, hgt = val * k * p, top = py1 - hgt;
    if (hgt > 1) { g.save(); rr(g, x - bw / 2, top, bw, hgt, [18, 18, 0, 0]); g.clip(); const gr = g.createLinearGradient(0, top, 0, py1); gr.addColorStop(0, mixHex(col, '#ffffff', .15)); gr.addColorStop(1, mixHex(col, '#10141c', .25)); g.fillStyle = gr; g.fillRect(x - bw / 2, top, bw, hgt); g.restore(); }
    if (p > 0) text(g, `${Math.round(val * p)} s`, x, top - 34, { fam: 'big', size: 52, color: col, align: 'center', base: 'middle' });
    text(g, name, x, py1 + 44, { size: 34, weight: 700, color: col, align: 'center', base: 'middle' });
    text(g, mins, x, py1 + 86, { size: 28, color: DIM, align: 'center', base: 'middle' });
  }
  // speed-up: dashed line at Before's height and 2.6x badge over the Foldline column
  const pm = seg(lt, tF + .7, tF + 1.1);
  if (pm > 0) {
    const yB = py1 - 426 * k;
    g.save(); g.globalAlpha = clamp(pm * 2); g.setLineDash([10, 10]); g.strokeStyle = 'rgba(255,106,61,.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(445 + 105, yB); g.lineTo(835 + 105, yB); g.stroke(); g.setLineDash([]);
    arrow(g, 835, yB + 14, 835, py1 - 161 * k - 80, YEL, 5, eo(pm), 16); g.restore();
    pop(g, 835, yB + 100, pm, () => pill(g, 835, (yB + py1 - 161 * k - 80) / 2 + 10, '2.6× faster', { fam: 'big', size: 40, bg: YEL, align: 'center' }), .5);
  }
  // right card: CPU
  const gx0 = 1120, gw = 700;
  glass(g, gx0, cy, gw, ch, 30);
  icGear(g, gx0 + 66, cy + 62, 52, TEAL, lt * .4);
  text(g, 'CPU work', gx0 + 110, cy + 62, { size: 44, weight: 700, base: 'middle' });
  text(g, 'CPU-seconds, lower is better', gx0 + 40, cy + 112, { size: 26, color: DIM, base: 'middle' });
  const gx = gx0 + gw / 2, gy = 570, R = 230;
  const ga = seg(lt, tG - .2, tG + .3), v = lerp(943, 134, eio(seg(lt, tS, tP + .4)));
  g.save(); g.lineCap = 'round';
  g.beginPath(); g.arc(gx, gy, R, Math.PI, TAU); g.strokeStyle = 'rgba(8,11,16,.55)'; g.lineWidth = 40; g.stroke();
  for (let i = 0; i <= 10; i++) { const a = Math.PI + Math.PI * i / 10; g.beginPath(); g.moveTo(gx + Math.cos(a) * (R - 32), gy + Math.sin(a) * (R - 32)); g.lineTo(gx + Math.cos(a) * (R - 44), gy + Math.sin(a) * (R - 44)); g.strokeStyle = 'rgba(243,239,230,.25)'; g.lineWidth = 3; g.stroke(); }
  if (ga > 0) {
    const f = v / 1000 * eo(ga), col = mixHex(TEAL, CORAL, clamp((v - 134) / (943 - 134)));
    const aB = Math.PI + Math.PI * .943; g.beginPath(); g.moveTo(gx + Math.cos(aB) * (R - 26), gy + Math.sin(aB) * (R - 26)); g.lineTo(gx + Math.cos(aB) * (R + 26), gy + Math.sin(aB) * (R + 26)); g.strokeStyle = CORAL; g.lineWidth = 5; g.stroke();
    g.beginPath(); g.arc(gx, gy, R, Math.PI, Math.PI + Math.PI * f); g.strokeStyle = col; g.lineWidth = 40; g.shadowColor = col; g.shadowBlur = 22; g.stroke(); g.shadowBlur = 0;
    const ea = Math.PI + Math.PI * f; g.beginPath(); g.arc(gx + Math.cos(ea) * R, gy + Math.sin(ea) * R, 13, 0, TAU); g.fillStyle = TXT; g.fill();
    g.globalAlpha = clamp(ga * 2);
    text(g, String(Math.round(v)), gx, gy - 66, { fam: 'big', size: 104, color: col, align: 'center', base: 'middle' });
    text(g, 'CPU-seconds', gx, gy - 4, { size: 28, color: DIM, align: 'center', base: 'middle' });
  }
  g.restore();
  text(g, '0', gx - R, gy + 46, { size: 22, color: DIM, align: 'center', base: 'middle' }); text(g, '1000', gx + R, gy + 46, { size: 22, color: DIM, align: 'center', base: 'middle' });
  fadeUp(g, seg(lt, tS, tS + .4), 12, () => {
    const a = 'Before 943', b = 'Foldline 134', wa = tw(g, a, 30, { weight: 700 }), wb = tw(g, b, 30, { weight: 700 }), tot = wa + 80 + wb, x0 = gx - tot / 2;
    text(g, a, x0, 668, { size: 30, weight: 700, color: CORAL, base: 'middle' }); arrow(g, x0 + wa + 16, 668, x0 + wa + 64, 668, DIM, 4, 1, 14); text(g, b, x0 + wa + 80, 668, { size: 30, weight: 700, color: TEAL, base: 'middle' });
  });
  pop(g, gx, 772, seg(lt, tP - .05, tP + .35), () => pill(g, gx, 772, '−86% CPU', { fam: 'big', size: 60, bg: YEL, align: 'center', h: 96 }), .5);
}

// 8. Same picture
function s08(g, lt, d, id) {
  const fw = 760, fh = 428, fy = 230, xs = [140, 1020];
  const tS = wt(id, 'side', .6), tT = wt(id, 'tell', .82);
  const labs = [['Before', CORAL], ['Foldline', TEAL]];
  xs.forEach((x, i) => {
    const p = seg(lt, -.3 + i * .12, .2 + i * .12);
    fadeUp(g, p, 30, () => {
      rr(g, x - 8, fy - 8, fw + 16, fh + 16, 22); shadowFill(g, '#2a3242', 36, 14, .5);
      g.save(); rr(g, x, fy, fw, fh, 14); g.clip(); g.drawImage(SUNSET, x, fy, fw, fh); g.restore();
      pill(g, x, fy - 50, labs[i][0], { size: 32, bg: labs[i][1], weight: 700 });
    });
  });
  // twin magnifiers sweeping the same path in both frames
  const pm = seg(lt, Math.min(tS - .4, .2 * d), tT + .4);
  if (pm > 0 && pm < 1) {
    const u = eio(pm), lx = lerp(.12, .88, u), ly = .5 + .22 * Math.sin(u * TAU * 1.0), R = 92, Z = 2.2, fade = Math.min(seg(pm, 0, .08), 1 - seg(pm, .92, 1));
    xs.forEach(x => {
      const cx = x + fw * lx, cy = fy + fh * ly;
      g.save(); g.globalAlpha = fade;
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
      const sx = lx * 1520 - R / Z * 2, sy = ly * 856 - R / Z * 2;
      g.drawImage(SUNSET, sx, sy, R / Z * 4, R / Z * 4, cx - R, cy - R, R * 2, R * 2); g.restore();
      g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.strokeStyle = CARD; g.lineWidth = 8; g.stroke();
      g.beginPath(); g.moveTo(cx + R * .72, cy + R * .72); g.lineTo(cx + R * 1.3, cy + R * 1.3); g.lineWidth = 16; g.lineCap = 'round'; g.stroke();
      g.restore();
    });
  }
  const ps = seg(lt, tT - .05, tT + .35);
  if (ps > 0) {
    pop(g, 960, fy + fh / 2, ps, () => { rr(g, 925, fy + fh / 2 - 34, 70, 68, 16); g.fillStyle = YEL; g.fill(); text(g, '=', 960, fy + fh / 2 + 4, { fam: 'big', size: 70, color: INK, align: 'center', base: 'middle' }); }, .5);
    g.save(); g.translate(960, 786); g.rotate(-4 * Math.PI / 180); const sc = lerp(1.6, 1, eo(ps)); g.scale(sc, sc); g.globalAlpha = clamp(ps * 2.5);
    const w = tw(g, 'Same picture', 64, { fam: 'big' }) + 80; rr(g, -w / 2, -50, w, 100, 18); g.fillStyle = 'rgba(16,20,28,.94)'; g.fill(); g.strokeStyle = YEL; g.lineWidth = 6; g.stroke();
    text(g, 'Same picture', 0, 3, { fam: 'big', size: 64, color: YEL, align: 'center', base: 'middle' }); g.restore();
  }
}

// 9. Fallback chain + sound check
function s09(g, lt, d, id) {
  heading(g, lt, -0.4, 'Checks its own work');
  const tC = wt(id, 'checks', .04) + .3, tX = wt(id, "can't", .3), tF = wt(id, 'falls', .4), tO = wt(id, 'own', .45, 1), tW = wt(id, "won't", .6);
  const T = [Math.max(.3, tC + .2), tX + .3, Math.max(tF + .3, tO)];
  const items = [['WebCodecs', 'fast path'], ['VideoToolbox', 'hardware fallback'], ['x264', 'software fallback']];
  const cxs = [380, 960, 1540], cy = 340, bw = 400, bh = 160;
  items.forEach(([a, b], i) => {
    const app = seg(lt, -.4 + i * .1, i * .1), on = eo(seg(lt, T[i] - .1, T[i] + .35));
    pop(g, cxs[i], cy, app, () => {
      const x = cxs[i] - bw / 2, y = cy - bh / 2;
      glass(g, x, y, bw, bh, 26);
      g.save(); if (on > 0) { g.shadowColor = TEAL; g.shadowBlur = 26 * on; } rr(g, x, y, bw, bh, 26); g.strokeStyle = on > 0 ? mixHex('#3a4356', TEAL, on) : '#3a4356'; g.lineWidth = 4; g.stroke(); g.restore();
      text(g, a, cxs[i], cy - 18, { fam: 'big', size: 52, color: on > 0 ? TXT : DIM, align: 'center', base: 'middle', maxW: bw - 60 });
      text(g, b, cxs[i], cy + 40, { size: 28, color: on > .5 ? TEAL : DIM, align: 'center', base: 'middle', maxW: bw - 60 });
      checkMark(g, x + bw - 6, y + 6, 30, TEAL, seg(lt, T[i], T[i] + .45));
    }, .85);
    if (i < 2) arrow(g, cxs[i] + bw / 2 + 14, cy, cxs[i + 1] - bw / 2 - 14, cy, on > 0 ? TEAL : '#3a4356', 6, eo(seg(lt, T[i + 1] - .45, T[i + 1] - .05)), 18);
  });
  fadeUp(g, seg(lt, T[2] + .2, T[2] + .7), 12, () => text(g, 'If one can’t run, the next one takes over, on its own.', 960, 470, { size: 32, color: DIM, align: 'center', base: 'middle', maxW: 1500 }));
  // the self-check log
  const logs = [[T[0] - .25, 'page: one #c canvas, 1920 x 1080', 'ok'], [T[0] + .35, 'hardware H.264 encoder: ready', 'ok'],
    [T[1] + .1, 'if not: VideoToolbox, then x264', 'next'], [tW + .1, 'audio track: present', 'ok']];
  fadeUp(g, seg(lt, T[0] - .6, T[0] - .2), 20, () => {
    const x = 100, y = 540, w = 830, h = 290; glass(g, x, y, w, h, 26);
    text(g, 'self-check', x + 32, y + 40, { fam: 'mono', size: 22, color: DIM, base: 'middle' });
    logs.forEach(([t0, s, kind], i) => {
      const p = seg(lt, t0, t0 + .3); if (p <= 0) return; const yy = y + 96 + i * 56;
      g.save(); g.globalAlpha *= clamp(p * 2); g.translate(14 * (1 - eo(p)), 0);
      if (kind === 'ok') checkMark(g, x + 50, yy, 15, TEAL, seg(lt, t0, t0 + .45)); else arrow(g, x + 36, yy, x + 64, yy, YEL, 4, 1, 12);
      text(g, s, x + 84, yy + 1, { fam: 'mono', size: 25, color: kind === 'ok' ? TXT : YEL, base: 'middle', maxW: w - 120 }); g.restore();
    });
  });
  // sound check card
  const ps = seg(lt, tW - .3, tW + .2);
  fadeUp(g, ps, 40, () => {
    const x = 990, y = 540, w = 830, h = 290;
    glass(g, x, y, w, h, 26, { stroke: 'rgba(46,196,166,.5)' });
    icSpeaker(g, x + 120, y + h / 2 - 10, 140, TEAL, lt);
    checkMark(g, x + 176, y + h / 2 + 42, 28, YEL, seg(lt, tW + .3, tW + .8));
    text(g, 'Never ships a', x + 260, y + 92, { size: 46, weight: 700, color: TXT, base: 'middle' });
    text(g, 'silent video', x + 260, y + 148, { size: 46, weight: 700, color: YEL, base: 'middle' });
    for (let i = 0; i < 22; i++) { const v = .25 + .75 * Math.abs(Math.sin(lt * 5.3 + i * .9) * Math.sin(lt * 2.1 + i * .37)); const bh2 = 8 + 44 * v; rr(g, x + 260 + i * 22, y + 256 - bh2, 12, bh2, 6); g.fillStyle = i < 22 * seg(lt, tW, tW + 1.2) ? TEAL : '#3a4356'; g.fill(); }
  });
}

// 10. Same scene, new looks, then the wall of 66 styles
const LOOKS = [['Flat', 'flat'], ['Paper', 'paper'], ['Neon', 'neon'], ['Pixel', 'pixel']];
function drawWall(g, lt, a) {
  if (a <= 0 || !TILES.length) return;
  g.save(); g.globalAlpha = a; g.translate(960, 480); g.rotate(-9 * Math.PI / 180); const z = lerp(1.25, 1, eo(a)); g.scale(z, z);
  const pw = 344, ph = 204, N = TILES.length;
  for (let r = -4; r <= 4; r++) {
    const dir = r % 2 ? 1 : -1, off = dir * lt * 46 + r * 97, base = Math.floor(off / pw), fr = off - base * pw;
    for (let j = -5; j <= 5; j++) {
      const x = j * pw + fr - pw / 2, y = r * ph - ph / 2, idx = mod(j - base + r * 7, N);
      g.save(); rr(g, x, y, 320, 180, 14); g.clip(); g.drawImage(TILES[idx], x, y); g.restore();
    }
  }
  g.restore();
  // darken edges and centre for the title
  const rg = g.createRadialGradient(960, 470, 100, 960, 470, 1100); rg.addColorStop(0, `rgba(16,20,28,${.35 * a})`); rg.addColorStop(1, `rgba(16,20,28,${.75 * a})`); g.fillStyle = rg; g.fillRect(0, 0, W, H);
}
function s10(g, lt, d, id) {
  const T6 = Math.max(1.8, wt(id, ['sixty', '66'], .42));
  const tA = -0.2, tB = T6 - .45, slot = (tB - tA) / 4;
  const fb = eio(seg(lt, T6 - .4, T6 + .35));
  drawWall(g, lt, fb);
  if (fb < 1) {
    const fw = 960, fh = 540, fx = 480, fy = 150, s = lerp(1, .3, fb);
    g.save(); g.globalAlpha = 1 - fb; g.translate(960, fy + fh / 2); g.scale(s, s); g.translate(-960, -(fy + fh / 2));
    rr(g, fx - 10, fy - 10, fw + 20, fh + 20, 26); shadowFill(g, '#2a3242', 40, 16, .5);
    g.save(); rr(g, fx, fy, fw, fh, 16); g.clip();
    const kb = 1 + .04 * seg(lt, tA, tB);
    const drawLook = (k) => { g.save(); g.translate(960, fy + fh / 2); g.scale(kb, kb); g.translate(-960, -(fy + fh / 2)); g.imageSmoothingEnabled = k !== 'pixel'; g.drawImage(LOOK[k], fx, fy, fw, fh); g.restore(); };
    const cur = clamp(Math.floor((lt - tA) / slot), 0, 3);
    drawLook(LOOKS[cur][1]);
    // wipe to the next look
    if (cur < 3) {
      const wp = eio(seg(lt, tA + (cur + 1) * slot - .35, tA + (cur + 1) * slot));
      if (wp > 0) { const X = lerp(fx - 120, fx + fw + 120, wp); g.save(); g.beginPath(); g.moveTo(fx - 200, fy); g.lineTo(X + 60, fy); g.lineTo(X - 60, fy + fh); g.lineTo(fx - 200, fy + fh); g.closePath(); g.clip(); drawLook(LOOKS[cur + 1][1]); g.restore();
        g.beginPath(); g.moveTo(X + 60, fy); g.lineTo(X - 60, fy + fh); g.strokeStyle = YEL; g.lineWidth = 8; g.stroke(); }
    }
    g.restore();
    pill(g, fx + 24, fy + 44, 'same scene, new look', { size: 26, bg: 'rgba(16,20,28,.8)', color: TXT, weight: 600 });
    g.restore();
    // tabs
    g.save(); g.globalAlpha = 1 - fb;
    const tabW = 200, gap = 20, tx0 = 960 - (4 * tabW + 3 * gap) / 2;
    const cur2 = clamp(Math.floor((lt - tA) / slot), 0, 3), lookF = cur2 + (cur2 < 3 ? eio(seg(lt, tA + (cur2 + 1) * slot - .35, tA + (cur2 + 1) * slot)) : 0);
    LOOKS.forEach(([name], i) => {
      const on = clamp(1 - Math.abs(lookF - i)), x = tx0 + i * (tabW + gap);
      rr(g, x, 732, tabW, 64, 32); g.fillStyle = PANEL; g.fill(); rr(g, x, 732, tabW, 64, 32); g.strokeStyle = LINEC; g.lineWidth = 2; g.stroke();
      if (on > 0) { g.save(); g.globalAlpha *= on; rr(g, x, 732, tabW, 64, 32); g.fillStyle = YEL; g.fill(); g.restore(); }
      text(g, name, x + tabW / 2, 765, { size: 32, weight: 700, color: on > .5 ? INK : DIM, align: 'center', base: 'middle' });
    });
    g.restore();
  }
  // title card over the wall
  const pt = seg(lt, T6 + .05, T6 + .5);
  pop(g, 960, 470, pt, () => {
    rr(g, 440, 330, 1040, 280, 34); shadowFill(g, 'rgba(16,20,28,.92)', 60, 20, .6); rr(g, 440, 330, 1040, 280, 34); g.strokeStyle = 'rgba(255,209,102,.5)'; g.lineWidth = 3; g.stroke();
    const n = Math.round(66 * eo(seg(lt, T6 + .05, T6 + .9)));
    const w1 = tw(g, String(66), 140, { fam: 'big' }), w2 = tw(g, ' film styles', 92, { fam: 'big' }), x0 = 960 - (w1 + w2) / 2;
    text(g, String(n), x0 + w1, 450, { fam: 'big', size: 140, color: YEL, align: 'right', base: 'middle' });
    text(g, ' film styles', x0 + w1, 458, { fam: 'big', size: 92, color: TXT, base: 'middle' });
    text(g, 'the lemo-opuscar library by LemoLab', 960, 548, { size: 40, color: DIM, align: 'center', base: 'middle', maxW: 960 });
  }, .7);
  fadeUp(g, seg(lt, T6 + .6, T6 + 1.1), 8, () => text(g, 'Style stills: LemoLab, CC BY 4.0', 1820, 870, { size: 22, color: 'rgba(243,239,230,.6)', align: 'right', base: 'middle' }));
}

// 11. Terminal: clone, install, render + HUD
function s11(g, lt, d, id) {
  const tC = wt(id, 'clone', .19) - .1, tI = wt(id, 'install', .45) - .1, tR = wt(id, 'render', .6) - .1, tO = wt(id, 'one', .85);
  const x = 160, y = 110, w = 1600, h = 690;
  rr(g, x, y, w, h, 24); shadowFill(g, '#0b0e14', 50, 18, .6); rr(g, x, y, w, h, 24); g.strokeStyle = LINEC; g.lineWidth = 2; g.stroke();
  rr(g, x, y, w, 56, [24, 24, 0, 0]); g.fillStyle = '#1a1f2a'; g.fill();
  [CORAL, YEL, TEAL].forEach((c, i) => { g.beginPath(); g.arc(x + 32 + i * 28, y + 28, 8, 0, TAU); g.fillStyle = c; g.fill(); });
  text(g, 'zsh · foldline', x + w / 2, y + 29, { size: 24, color: DIM, align: 'center', base: 'middle', weight: 500 });
  const fs = 27, lh = 50, x0 = x + 40; let yy = y + 116; const cw = tw(g, 'M', fs, { fam: 'mono' });
  const cmds = [[tC, 'git clone https://github.com/alireza12t/foldline.git', [["Cloning into 'foldline'... done.", DIM]]],
    [tI, 'cd foldline && npm ci', [['added packages, 0 vulnerabilities', DIM]]],
    [tR, 'node core/render/video.mjs my-film --fps 60 --out film.mp4', []]];
  let lastEnd = 0;
  cmds.forEach(([t0, cmd, out], i) => {
    if (lt < t0 - .25 && i > 0) return;
    const dur = Math.min(.7, .012 * cmd.length + .1), n = Math.floor(cmd.length * seg(lt, t0, t0 + dur));
    text(g, '~/foldline', x0, yy, { fam: 'mono', size: fs, color: TEAL }); text(g, '$', x0 + cw * 11, yy, { fam: 'mono', size: fs, color: YEL });
    text(g, cmd.slice(0, n), x0 + cw * 13, yy, { fam: 'mono', size: fs, color: TXT });
    const typing = lt < t0 + dur + .15 && (i === 2 || lt < cmds[i + 1][0] - .25);
    if (typing && (lt * 2.4) % 1 < .6) { g.fillStyle = TXT; g.fillRect(x0 + cw * (13 + n) + 2, yy - 22, cw * .6, 28); }
    if (i === 2 && n === cmd.length) { const po = seg(lt, tO - .1, tO + .3); pop(g, x0 + cw * (13 + cmd.length) + 120, yy - 9, po, () => pill(g, x0 + cw * (13 + cmd.length) + 24, yy - 9, 'one command', { size: 26, bg: YEL, weight: 700 }), .6); }
    yy += lh;
    for (const [s, c] of out) { if (lt > t0 + dur + .15) text(g, s, x0, yy, { fam: 'mono', size: fs, color: c }); yy += lh; }
    lastEnd = t0 + dur;
  });
  // render output + HUD
  const tP = tR + Math.min(.7, .012 * 58 + .1) + .2, tEnd = Math.max(tP + 1.2, d + .1);
  if (lt > tP - .1) {
    text(g, 'encoder: WebCodecs, hardware H.264 (fast path)', x0, yy, { fam: 'mono', size: fs, color: TEAL }); yy += lh + 20;
    const u = seg(lt, tP, tEnd), frames = Math.floor(6000 * eio(u)), fps = Math.round(168 * eo(seg(lt, tP, tP + 1.0)) + 4 * Math.sin(lt * 13) * seg(lt, tP + .6, tP + 1));
    const hx = x0, hy = yy - 6, hw = w - 80, hh = 120;
    rr(g, hx, hy, hw, hh, 18); g.fillStyle = '#141a24'; g.fill(); g.strokeStyle = 'rgba(46,196,166,.35)'; g.lineWidth = 2; g.stroke();
    rr(g, hx + 28, hy + 70, hw - 56, 22, 11); g.fillStyle = '#263041'; g.fill();
    if (u > 0) { rr(g, hx + 28, hy + 70, Math.max(22, (hw - 56) * eio(u)), 22, 11); g.fillStyle = TEAL; g.fill(); }
    text(g, `frames ${frames.toLocaleString('en-US')} / 6,000`, hx + 28, hy + 40, { fam: 'mono', size: 26, color: TXT, base: 'middle' });
    text(g, `${Math.round(100 * eio(u))}%`, hx + hw / 2, hy + 40, { fam: 'mono', size: 26, color: DIM, align: 'center', base: 'middle' });
    g.save(); g.shadowColor = fps >= 160 ? YEL : 'transparent'; g.shadowBlur = 18;
    text(g, `${Math.max(0, fps)} fps`, hx + hw - 28, hy + 40, { fam: 'big', size: 46, color: fps >= 160 ? YEL : TXT, align: 'right', base: 'middle' }); g.restore();
    if (u >= 1) text(g, 'wrote film.mp4', x0, hy + hh + 50, { fam: 'mono', size: fs, color: TEAL });
  }
}

// 12. End card
function s12(g, lt, d, id) {
  const ang = i => { const u = seg(lt, -.35 + i * .09, -.35 + i * .09 + 1.0); const open = (82 * Math.PI / 180) * (1 - back(u, 1.25)); const idle = seg(lt, 1.6, 2.6) * .1 * Math.sin(lt * 1.3 + i * .8); return open + idle; };
  drawStrip(g, 960, 300 + Math.sin(lt * .9) * 5, .78, ang);
  const tFree = wt(id, 'free', .2), tMade = wt(id, 'made', .45), tCome = wt(id, 'come', .8);
  pop(g, 960, 482, seg(lt, tFree - .1, tFree + .35), () => pill(g, 960, 482, 'free and open source', { size: 30, bg: TEAL, align: 'center', weight: 700 }), .7);
  fadeUp(g, seg(lt, tFree + .3, tFree + .8), 20, () => {
    const w = tw(g, 'github.com/alireza12t/foldline', 50, { weight: 700 }) + 90;
    rr(g, 960 - w / 2, 540, w, 92, 46); g.fillStyle = PANEL; g.fill(); g.strokeStyle = 'rgba(243,239,230,.18)'; g.lineWidth = 2; g.stroke();
    text(g, 'github.com/alireza12t/foldline', 960, 588, { size: 50, weight: 700, color: TXT, align: 'center', base: 'middle' });
  });
  fadeUp(g, seg(lt, tMade - .1, tMade + .4), 16, () => {
    const a = 'Made for Unfold', b = '  ·  youtube.com/@UnfoldAnimated', wa = tw(g, a, 38, { weight: 700 }), wb = tw(g, b, 38, { weight: 500 }), x0 = 960 - (wa + wb) / 2;
    text(g, a, x0, 700, { size: 38, weight: 700, color: YEL, base: 'middle' }); text(g, b, x0 + wa, 700, { size: 38, weight: 500, color: TXT, base: 'middle' });
  });
  fadeUp(g, seg(lt, Math.min(tCome - .2, tMade + 1.2), Math.min(tCome + .3, tMade + 1.7)), 12, () => text(g, 'Built on lemo-opuscar by LemoLab', 960, 780, { size: 30, color: DIM, align: 'center', base: 'middle' }));
}

const SCENES = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12];
const TRANS = ['fold', 'wipe', 'slide', 'slide', 'wipe', 'slide', 'fold', 'zoom', 'wipe', 'zoom', 'fold'];

// ---------- captions ----------
const CAP = { size: 42, maxW: 1360, y: 960, bx: 210, bw: 1500, bh: 84 };
let CHUNKS = {};
// Align the script's words to the ASR words (edit distance), so captions read the script but keep the spoken timing
function alignWords(id) {
  const A = WORDS[id], line = (SCRIPT || []).find(l => l.id === id), txt = line && (line.display || line.text);
  if (!txt || !A.length) return A;
  const Sw = txt.split(/\s+/).filter(Boolean), n = Sw.length, m = A.length, key = w => norm(w).replace(/[-']/g, '');
  const dp = [], bt = [];
  for (let i = 0; i <= n; i++) { dp.push(new Float64Array(m + 1)); bt.push(new Uint8Array(m + 1)); dp[i][0] = i; bt[i][0] = 2; }
  for (let j = 0; j <= m; j++) { dp[0][j] = j; bt[0][j] = 1; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const a = key(Sw[i - 1]), b = key(A[j - 1][0]), same = a === b || (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a)));
    const sub = dp[i - 1][j - 1] + (same ? 0 : .6), ins = dp[i][j - 1] + 1, del = dp[i - 1][j] + 1;
    if (sub <= ins && sub <= del) { dp[i][j] = sub; bt[i][j] = 0; } else if (ins <= del) { dp[i][j] = ins; bt[i][j] = 1; } else { dp[i][j] = del; bt[i][j] = 2; }
  }
  const own = new Array(m).fill(0); let i = n, j = m;
  while (i > 0 || j > 0) { const b = i > 0 && j > 0 ? bt[i][j] : (j > 0 ? 1 : 2); if (b === 0) { own[j - 1] = i - 1; i--; j--; } else if (b === 1) { own[j - 1] = Math.max(0, i - 1); j--; } else i--; }
  const out = Sw.map(w => [w, null, null]);
  A.forEach((a, k) => { const o = out[own[k]]; o[1] = o[1] === null ? a[1] : Math.min(o[1], a[1]); o[2] = o[2] === null ? a[2] : Math.max(o[2], a[2]); });
  for (let k = 0; k < n; k++) if (out[k][1] === null) { const prev = k ? out[k - 1][2] : 0; let nx = null; for (let q = k + 1; q < n; q++) if (out[q][1] !== null) { nx = out[q][1]; break; } out[k][1] = prev; out[k][2] = nx ?? prev; }
  for (let k = 1; k < n; k++) if (out[k][1] < out[k - 1][1]) out[k][1] = out[k - 1][1];
  return out;
}
function buildCaptions() {
  for (const id of IDS) {
    const ws = alignWords(id), out = []; let cur = [], cw = 0; const sp = tw(ctx, ' ', CAP.size);
    ws.forEach((w, i) => {
      const ww = tw(ctx, w[0], CAP.size, { weight: 600 });
      if (cur.length && (cw + sp + ww > CAP.maxW || (/[.!?]$/.test(cur[cur.length - 1][0]) && cur.length >= 2))) { out.push(cur); cur = []; cw = 0; }
      cur.push([w[0], w[1], w[2], ww]); cw += (cur.length > 1 ? sp : 0) + ww;
    });
    if (cur.length) out.push(cur);
    CHUNKS[id] = out.map(c => ({ words: c, t0: c[0][1], w: c.reduce((a, w) => a + w[3], 0) + sp * (c.length - 1), sp }));
  }
}
function captions(g, t) {
  const band = Math.min(seg(t, S.l01 - .4, S.l01 - .1), 1 - seg(t, S.l12 + D.l12 + .5, S.l12 + D.l12 + 1.0));
  if (band <= 0) return;
  g.save(); g.globalAlpha = band;
  rr(g, CAP.bx, CAP.y - CAP.bh / 2, CAP.bw, CAP.bh, 22); g.fillStyle = 'rgba(9,12,18,.86)'; g.fill(); g.strokeStyle = 'rgba(243,239,230,.08)'; g.lineWidth = 2; g.stroke();
  // which chunk
  let best = null;
  for (const id of IDS) {
    const lt = t - S[id]; if (lt < -0.15 || lt > D[id] + .45) continue;
    const ch = CHUNKS[id]; for (let i = 0; i < ch.length; i++) { const t1 = i + 1 < ch.length ? ch[i + 1].t0 : D[id] + .45; if (lt >= ch[i].t0 - .15 && lt < t1 - .02) best = { c: ch[i], lt, t0: ch[i].t0 }; }
  }
  if (best) {
    const { c, lt } = best, a = seg(lt, c.t0 - .15, c.t0 - .02);
    g.globalAlpha = band * a; let x = 960 - c.w / 2;
    for (const [s, w0, w1, ww] of c.words) {
      const on = lt >= w0 - .02 && lt < w1 + .02, past = lt >= w1;
      if (on) { const p = seg(lt, w0 - .02, w0 + .1); rr(g, x - 10, CAP.y - 29, ww + 20, 58, 12); g.fillStyle = `rgba(255,209,102,${.16 * p})`; g.fill(); }
      text(g, s, x, CAP.y + 1, { size: CAP.size, weight: 600, base: 'middle', color: on ? YEL : past ? TXT : 'rgba(243,239,230,.45)' });
      x += ww + c.sp;
    }
  }
  g.restore();
}

// ---------- frame ----------
const LA = mk(W, H), LB = mk(W, H), ga = LA.getContext('2d'), gb = LB.getContext('2d');
function drawScene(g, i, t) {
  const id = IDS[i], lt = t - S[id], d = D[id];
  const u = clamp((lt + .45) / (d + .9)), s = 1 + .012 * u;
  g.save(); g.translate(960, 500); g.scale(s, s); g.translate(-960, -500 - 4 * u);
  SCENES[i](g, lt, d, id); g.restore();
}
function background(t) {
  ctx.drawImage(BG, 0, 0);
  const ox = -(t * 7 % 60), oy = -(t * 4 % 60);
  ctx.drawImage(GRID, ox - 30, oy - 30);
}
function composite(type, p, A, B) {
  const e = eio(p);
  if (type === 'slide') {
    ctx.save(); ctx.globalAlpha = 1 - .5 * e; ctx.drawImage(A, -W * e, 0); ctx.restore();
    ctx.save(); ctx.globalAlpha = .5 + .5 * e; ctx.drawImage(B, W * (1 - e), 0); ctx.restore();
  } else if (type === 'zoom') {
    ctx.save(); ctx.globalAlpha = 1 - e; ctx.translate(960, 500); ctx.scale(1 + .14 * e, 1 + .14 * e); ctx.drawImage(A, -960, -500); ctx.restore();
    ctx.save(); ctx.globalAlpha = e; ctx.translate(960, 500); ctx.scale(.9 + .1 * e, .9 + .1 * e); ctx.drawImage(B, -960, -500); ctx.restore();
  } else if (type === 'fold') {
    const first = p < .5, L = first ? A : B, u = first ? eio(p * 2) : 1 - eio((p - .5) * 2), sx = Math.max(.001, Math.cos(u * Math.PI / 2));
    const lg = L.getContext('2d'); lg.save(); lg.globalCompositeOperation = 'source-atop';
    const gr = lg.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, `rgba(0,0,0,${.65 * u})`); gr.addColorStop(.5, `rgba(0,0,0,${.2 * u})`); gr.addColorStop(1, `rgba(255,255,255,${.12 * u})`);
    lg.fillStyle = gr; lg.fillRect(0, 0, W, H); lg.restore();
    ctx.save(); ctx.globalAlpha = 1 - .3 * u; ctx.translate(960, 0); ctx.scale(sx, 1); ctx.drawImage(L, -960, 0); ctx.restore();
    // the fold line
    ctx.save(); ctx.globalAlpha = Math.sin(u * Math.PI) * .9; ctx.strokeStyle = TEAL; ctx.lineWidth = 4; ctx.setLineDash([22, 14]); ctx.beginPath(); ctx.moveTo(960, 60); ctx.lineTo(960, 880); ctx.stroke(); ctx.restore();
  } else {   // wipe: a slanted teal band sweeps left to right
    const X = lerp(-260, W + 260, e), k = 200;
    ctx.save(); ctx.beginPath(); ctx.moveTo(X + k, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(X - k, H); ctx.closePath(); ctx.clip(); ctx.drawImage(A, 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(X + k, 0); ctx.lineTo(X - k, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(X + k, 0); ctx.lineTo(X + k + 40, 0); ctx.lineTo(X - k + 40, H); ctx.lineTo(X - k, H); ctx.closePath(); ctx.fillStyle = TEAL; ctx.fill();
    ctx.beginPath(); ctx.moveTo(X + k + 40, 0); ctx.lineTo(X + k + 50, 0); ctx.lineTo(X - k + 50, H); ctx.lineTo(X - k + 40, H); ctx.closePath(); ctx.fillStyle = YEL; ctx.fill(); ctx.restore();
  }
}
function render(t) {
  t = clamp(+t || 0, 0, DUR);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true;
  background(t);
  let k = -1; for (let i = 0; i < MID.length; i++) if (Math.abs(t - MID[i]) < TR / 2) k = i;
  if (k >= 0) {
    ga.setTransform(1, 0, 0, 1, 0, 0); ga.clearRect(0, 0, W, H); gb.setTransform(1, 0, 0, 1, 0, 0); gb.clearRect(0, 0, W, H);
    drawScene(ga, k, t); drawScene(gb, k + 1, t);
    composite(TRANS[k], (t - (MID[k] - TR / 2)) / TR, LA, LB);
  } else {
    let i = 0; while (i < MID.length && t >= MID[i]) i++;
    drawScene(ctx, i, t);
  }
  captions(ctx, t);
  // progress line
  ctx.fillStyle = 'rgba(243,239,230,.07)'; ctx.fillRect(0, 1074, W, 6);
  ctx.fillStyle = TEAL; ctx.fillRect(0, 1074, W * t / DUR, 6);
}
window.render = render;

// ---------- ready ----------
await Promise.all(['500 40px Fredoka', '600 40px Fredoka', '700 40px Fredoka', '400 40px "Lilita One"', '400 24px Menlo'].map(f => document.fonts.load(f)));
await document.fonts.ready;
buildArt();
await loadTiles();
buildCaptions();
render(0);
window.READY = true;
