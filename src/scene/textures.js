// 程序化贴图（Canvas 生成）：涂装、面板缝、铆钉、烧蚀层、隔热毯
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function tex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function grime(ctx, w, h, r, n, alpha, color = '0,0,0') {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, s = 2 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, `rgba(${color},${alpha * r()})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - s, y - s, s * 2, s * 2);
  }
}

/** 弹体舱段涂装：u 绕周向，v 沿轴向（下→上）。opts: base, stripes, bands, label */
export function stageTextures({ base = '#e9ecec', seed = 1, rollPattern = true, label = '', bands = [], panelRows = 6, dark = false, raceway = true } = {}) {
  const W = 1024, H = 1024, r = rnd(seed);
  const [c, ctx] = canvas(W, H), [rc, rctx] = canvas(W, H);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  // 粗糙度底：油漆较光滑
  rctx.fillStyle = dark ? '#b0b0b0' : '#7a7a7a'; rctx.fillRect(0, 0, W, H);
  // 轻微色差
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${dark ? '255,255,255' : '90,95,100'},${r() * .025})`; ctx.fillRect(r() * W, r() * H, 10 + r() * 120, 4 + r() * 60); }
  // 滚转观测涂装（测试弹常见的黑白象限条纹）
  if (rollPattern) {
    ctx.fillStyle = '#16181a';
    for (let q = 0; q < 2; q++) ctx.fillRect(W * (q * .5 + .125), H * .58, W * .25, H * .18);
  }
  for (const b of bands) { ctx.fillStyle = b.color; ctx.fillRect(0, H * (1 - b.v1), W, H * (b.v1 - b.v0)); }
  // 面板缝与铆钉
  ctx.strokeStyle = dark ? 'rgba(0,0,0,.55)' : 'rgba(40,45,50,.35)'; ctx.lineWidth = 2;
  for (let i = 1; i < panelRows; i++) { const y = H * i / panelRows; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let i = 0; i < 8; i++) { const x = W * i / 8 + 3; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.fillStyle = dark ? 'rgba(160,160,160,.35)' : 'rgba(60,64,70,.3)';
  for (let i = 0; i <= panelRows; i++) for (let x = 0; x < W; x += 9) ctx.fillRect(x, H * i / panelRows - 6, 2, 2), ctx.fillRect(x, H * i / panelRows + 5, 2, 2);
  // 电缆整流罩（沿轴向的长条）
  if (raceway) {
    ctx.fillStyle = dark ? '#3a3d40' : '#cfd3d4'; ctx.fillRect(W * .31, 0, W * .025, H);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(W * .335, 0, 3, H);
    rctx.fillStyle = '#909090'; rctx.fillRect(W * .31, 0, W * .025, H);
  }
  // 标识
  if (label) {
    ctx.save(); ctx.translate(W * .78, H * .5); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = dark ? '#d8d8d8' : '#1b1e21'; ctx.font = 'bold 54px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, 0, 18); ctx.restore();
    ctx.fillStyle = '#c8402e'; ctx.fillRect(W * .1, H * .3, 60, 14);
    ctx.fillStyle = dark ? '#ccc' : '#222'; ctx.font = '18px monospace'; ctx.fillText('NO STEP', W * .6, H * .92);
  }
  grime(ctx, W, H, r, 60, .06);
  grime(rctx, W, H, r, 80, .25, '255,255,255');
  return { map: tex(c), roughnessMap: tex(rc, false) };
}

/** 喷管：碳/酚醛烧蚀内衬 + 金属外壳 */
export function nozzleTexture(seed = 3) {
  const W = 256, H = 512, r = rnd(seed), [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a2622'); g.addColorStop(.6, '#1a1816'); g.addColorStop(1, '#3b3530');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(${r() > .5 ? '255,240,220' : '0,0,0'},${r() * .06})`; ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 8); }
  for (let y = 0; y < H; y += 32) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, y, W, 2); }
  return tex(c);
}

/** 再入体烧蚀防热层：深褐碳化纹理 */
export function heatshieldTexture(seed = 7) {
  const W = 512, H = 512, r = rnd(seed), [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#2e2620'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) { const v = 30 + r() * 40; ctx.fillStyle = `rgba(${v + 20},${v + 8},${v},${.08 + r() * .1})`; ctx.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 4); }
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5;
  for (let y = 0; y < H; y += 46) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  return tex(c);
}

/** 卫星多层隔热毯（金色箔片褶皱） */
export function mliTexture(seed = 11) {
  const W = 512, H = 512, r = rnd(seed), [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#b8892c'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * H, w = 20 + r() * 120, h = 6 + r() * 40;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, `rgba(255,220,130,${r() * .5})`); g.addColorStop(.5, `rgba(90,60,10,${r() * .5})`); g.addColorStop(1, `rgba(255,235,170,${r() * .4})`);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  return tex(c);
}

export function solarTexture() {
  const W = 512, H = 256, [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#0a1636'; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 16) for (let y = 0; y < H; y += 16) {
    ctx.fillStyle = `rgb(${18 + (x * 7 % 9)},${34 + (y % 11)},${82 + ((x + y) % 23)})`; ctx.fillRect(x + 1, y + 1, 14, 14);
  }
  ctx.strokeStyle = '#8a8f99'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, W - 2, H - 2);
  return tex(c);
}

/** 舰船/平台：灰色涂装 + 锈迹 + 甲板防滑 */
export function navalTexture(seed = 5, base = '#7d858c') {
  const W = 512, H = 512, r = rnd(seed), [c, ctx] = canvas(W, H);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 600; i++) { ctx.fillStyle = `rgba(${r() > .7 ? '120,70,40' : '30,35,40'},${r() * .06})`; ctx.fillRect(r() * W, r() * H, 2 + r() * 30, 2 + r() * 30); }
  ctx.strokeStyle = 'rgba(0,0,0,.18)';
  for (let y = 0; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 0; x < W; x += 96) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  // 锈迹流痕
  for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H; const g = ctx.createLinearGradient(x, y, x, y + 60); g.addColorStop(0, 'rgba(110,60,30,.18)'); g.addColorStop(1, 'rgba(110,60,30,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, 3, 60); }
  return tex(c, true, true);
}

/** 软粒子贴图（烟团） */
export function puffTexture() {
  const W = 128, [c, ctx] = canvas(W, W), r = rnd(19);
  for (let i = 0; i < 26; i++) {
    const x = W / 2 + (r() - .5) * W * .45, y = W / 2 + (r() - .5) * W * .45, s = W * (.14 + r() * .22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  return tex(c, false);
}
