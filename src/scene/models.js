// 程序化三维模型（单位：米，+Y 为弹体轴向；使用时整体缩放 0.001 转为 km）
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stageTextures, nozzleTexture, heatshieldTexture, mliTexture, solarTexture, navalTexture } from './textures.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
const std = (o) => new THREE.MeshStandardMaterial({ roughness: .6, metalness: .1, ...o });

function lathe(points, mat, seg = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(points, seg, phiStart, phiLength), mat);
  m.castShadow = m.receiveShadow = false;
  return m;
}

/** 钟形喷管：throatY 为喉部（上），exitY 为出口（下） */
function bellNozzle(throatY, exitY, rThroat, rExit, mats) {
  const pts = [], n = 18;
  for (let i = 0; i <= n; i++) {
    const s = i / n, y = throatY + (exitY - throatY) * s;
    const r = rThroat + (rExit - rThroat) * (1 - Math.pow(1 - s, 1.8));
    pts.push(V2(r, y));
  }
  const g = new THREE.Group();
  // 外壁（反向点序使法线朝外）
  g.add(lathe([...pts].reverse().map(p => V2(p.x + .012, p.y)), mats.outer, 48));
  const inner = lathe(pts, mats.inner, 48); inner.material = mats.inner; g.add(inner);
  // 出口加强环
  const ring = new THREE.Mesh(new THREE.TorusGeometry(rExit + .012, .02, 8, 48), mats.ring);
  ring.rotation.x = Math.PI / 2; ring.position.y = exitY; g.add(ring);
  return g;
}

function nozzleMats() {
  const t = nozzleTexture();
  return {
    outer: std({ color: 0x3b3835, roughness: .75, metalness: .35, map: t }),
    inner: std({ color: 0x8a7d70, roughness: .95, metalness: 0, map: t, side: THREE.BackSide, emissive: new THREE.Color(0xff6a20), emissiveIntensity: 0 }),
    ring: std({ color: 0x77706a, roughness: .4, metalness: .8 }),
  };
}

function raceway(y0, y1, r, angle, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(.11, y1 - y0, .07), mat);
  m.position.set(Math.cos(angle) * (r + .03), (y0 + y1) / 2, Math.sin(angle) * (r + .03));
  m.rotation.y = -angle;
  return m;
}

// ---------------------------------------------------------------------------
// 三级运载器
// ---------------------------------------------------------------------------
export function buildLaunchVehicle() {
  const parts = {};
  const nm = nozzleMats();
  const metal = std({ color: 0x9da3a8, roughness: .35, metalness: .85 });
  const darkMetal = std({ color: 0x3f4448, roughness: .5, metalness: .6 });

  // 一级（含级间段 1-2）
  {
    const g = new THREE.Group(); g.name = 's1';
    const t = stageTextures({ seed: 3, label: 'EDU-3  STAGE 1', rollPattern: true, panelRows: 7 });
    const mat = std({ ...t, roughness: .55 });
    g.add(lathe([V2(.3, 0), V2(.95, 0), V2(.95, .08), V2(.93, .9), V2(.92, 1.0), V2(.92, 7.4), V2(.02, 7.4)], mat, 72));
    const isT = stageTextures({ seed: 4, base: '#3a3e42', dark: true, rollPattern: false, panelRows: 3, raceway: false });
    g.add(lathe([V2(.92, 7.4), V2(.715, 8.6), V2(.69, 8.6), V2(.9, 7.42)], std({ ...isT, metalness: .4, roughness: .5, side: THREE.DoubleSide }), 72));
    // 底部隔热罩与喷管
    g.add(lathe([V2(.95, .02), V2(.35, .05), V2(.34, .02)], darkMetal, 48));
    const nz = bellNozzle(.35, -.6, .2, .58, nm); g.add(nz); parts.s1Nozzle = nz;
    g.add(raceway(1.0, 7.3, .92, -.9, metal));
    // 级间分离线、反推小火箭整流罩
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const b = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, .55, 12), darkMetal); b.position.set(Math.cos(a) * .86, 7.75, Math.sin(a) * .86); b.rotation.z = Math.cos(a) * .18; b.rotation.x = -Math.sin(a) * .18; g.add(b); }
    // 尾部作动器整流包
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const f = new THREE.Mesh(new THREE.BoxGeometry(.18, .7, .16), mat); f.position.set(Math.cos(a) * .97, .45, Math.sin(a) * .97); f.rotation.y = -a; g.add(f); }
    parts.s1 = g;
  }
  // 二级（含级间段 2-3）
  {
    const g = new THREE.Group(); g.name = 's2';
    const t = stageTextures({ seed: 8, label: 'STAGE 2', rollPattern: false, panelRows: 5, bands: [{ v0: .02, v1: .06, color: '#1d2023' }] });
    const mat = std({ ...t });
    g.add(lathe([V2(.2, 8.6), V2(.71, 8.6), V2(.71, 13.1), V2(.02, 13.1)], mat, 64));
    g.add(lathe([V2(.71, 13.1), V2(.625, 13.8), V2(.6, 13.8), V2(.69, 13.12)], std({ ...stageTextures({ seed: 9, base: '#3a3e42', dark: true, rollPattern: false, panelRows: 2, raceway: false }), metalness: .4, side: THREE.DoubleSide }), 64));
    const nz = bellNozzle(8.6, 7.55, .14, .5, nm); g.add(nz);
    g.add(raceway(8.7, 13.0, .71, -.9, metal));
    parts.s2 = g;
  }
  // 三级 + 仪器舱
  {
    const g = new THREE.Group(); g.name = 's3';
    const t = stageTextures({ seed: 12, label: 'S3', rollPattern: false, panelRows: 4 });
    g.add(lathe([V2(.2, 13.8), V2(.62, 13.8), V2(.62, 16.0), V2(.02, 16.0)], std({ ...t }), 64));
    g.add(lathe([V2(.62, 16.0), V2(.62, 16.3), V2(.02, 16.3)], std({ color: 0x2b2e31, roughness: .45, metalness: .5 }), 64));
    g.add(bellNozzle(13.8, 12.95, .1, .42, nm));
    g.add(raceway(13.9, 15.95, .62, -.9, metal));
    parts.s3 = g;
  }
  // 末助推舱（PBV）
  {
    const g = new THREE.Group(); g.name = 'pbv';
    const gold = std({ map: mliTexture(), color: 0xffffff, roughness: .35, metalness: .9 });
    g.add(lathe([V2(.58, 16.3), V2(.58, 16.95), V2(.3, 17.02), V2(.02, 17.02)], gold, 48));
    g.add(lathe([V2(.6, 16.3), V2(.6, 16.36), V2(.02, 16.36)], darkMetal, 48));
    // 姿控/轴向推力器
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, n = new THREE.Mesh(new THREE.ConeGeometry(.045, .12, 12, 1, true), metal);
      n.position.set(Math.cos(a) * .6, 16.65, Math.sin(a) * .6); n.rotation.z = Math.PI / 2; n.rotation.y = -a; g.add(n);
    }
    // 释放机构夹具
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const c = new THREE.Mesh(new THREE.BoxGeometry(.08, .16, .08), darkMetal); c.position.set(Math.cos(a) * .25, 17.08, Math.sin(a) * .25); g.add(c); }
    parts.pbv = g;
  }
  // 再入体（双锥）
  parts.rv = buildRV();
  parts.rv.position.y = 17.1;
  // 整流罩（两瓣）
  {
    const t = stageTextures({ seed: 21, rollPattern: false, panelRows: 3, raceway: false, bands: [{ v0: .0, v1: .04, color: '#2a2d30' }] });
    const mat = std({ ...t, side: THREE.DoubleSide, roughness: .45 });
    const prof = [];
    const L = 3.3, R0 = .62;
    prof.push(V2(R0, 16.3)); prof.push(V2(R0, 17.1));
    for (let i = 1; i <= 24; i++) { const s = i / 24; const y = 17.1 + (L - .8) * s; const r = R0 * Math.sqrt(Math.max(0, 1 - Math.pow(s, 1.9))) * .98 + .02; prof.push(V2(Math.max(.03, r * (1 - s * .02)), y)); }
    prof.push(V2(.001, 19.62));
    for (const [k, phi] of [['shroudL', 0], ['shroudR', Math.PI]]) {
      const half = lathe(prof, mat, 40, phi, Math.PI);
      const g = new THREE.Group(); g.add(half); g.name = k;
      // 分离铰链线
      const seam = new THREE.Mesh(new THREE.BoxGeometry(.02, 3.3, .04), darkMetal); seam.position.set(Math.cos(phi) * .62, 17.8, 0); g.add(seam);
      parts[k] = g;
    }
  }
  const root = new THREE.Group();
  for (const k of ['s1', 's2', 's3', 'pbv', 'rv', 'shroudL', 'shroudR']) root.add(parts[k]);
  // 各部件在弹体坐标中的轴向中心（用于分离后单独显示时对中）
  const centers = { s1: 4.0, s2: 10.5, s3: 14.9, pbv: 16.6, rv: 18.0, shroudL: 18.0, shroudR: 18.0 };
  return { root, parts, centers, nozzleInner: nm.inner };
}

export function buildRV() {
  const g = new THREE.Group(); g.name = 'rv';
  const hs = std({ map: heatshieldTexture(), color: 0xffffff, roughness: .8, metalness: .05 });
  const tip = std({ color: 0x9c968f, roughness: .3, metalness: .9 });
  const pts = [V2(.01, 0), V2(.28, 0), V2(.28, .04), V2(.2, .85), V2(.075, 1.7)];
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(V2(.035 * Math.cos(a) + (i < 8 ? .0 : 0), 1.72 + .035 * Math.sin(a))); }
  const body = lathe(pts.slice(0, 5).concat([V2(.04, 1.72)]), hs, 64); g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.04, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), tip); nose.position.y = 1.72; g.add(nose);
  // 后盖与天线窗
  g.add(lathe([V2(.27, .001), V2(.12, -.05), V2(.01, -.05)], std({ color: 0x1d1c1b, roughness: .5, metalness: .4 }), 48));
  const win = new THREE.Mesh(new THREE.BoxGeometry(.05, .12, .01), std({ color: 0x505860, roughness: .3 })); win.position.set(0, .5, .245); win.rotation.x = -.15; g.add(win);
  return g;
}

// ---------------------------------------------------------------------------
// 拦截弹（助推器 + 二级 + 动能杀伤器）
// ---------------------------------------------------------------------------
export function buildInterceptor() {
  const parts = {};
  const nm = nozzleMats();
  const white = std({ ...stageTextures({ seed: 31, base: '#e3e6e6', rollPattern: false, panelRows: 3, label: 'INT', raceway: false }) });
  const dark = std({ color: 0x2a2d30, roughness: .5, metalness: .5 });
  {
    const g = new THREE.Group();
    g.add(lathe([V2(.08, 0), V2(.19, 0), V2(.19, 3.0), V2(.15, 3.1), V2(.02, 3.1)], white, 40));
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(.02, .55, .42), dark);
      const a = i * Math.PI / 2; fin.position.set(Math.cos(a) * .36, .4, Math.sin(a) * .36); fin.rotation.y = -a + Math.PI / 2;
      g.add(fin);
    }
    g.add(bellNozzle(.1, -.28, .07, .16, nm));
    parts.booster = g;
  }
  {
    const g = new THREE.Group();
    g.add(lathe([V2(.06, 3.1), V2(.15, 3.1), V2(.15, 5.0), V2(.02, 5.0)], white, 40));
    g.add(lathe([V2(.15, 4.6), V2(.152, 5.0), V2(.15, 5.0)], dark, 40));
    parts.stage2 = g;
  }
  {
    const g = new THREE.Group();
    const kvMat = std({ color: 0x55595d, roughness: .4, metalness: .7 });
    g.add(lathe([V2(.13, 5.0), V2(.13, 5.35), V2(.09, 5.75), V2(.03, 5.9), V2(.001, 5.9)], kvMat, 32));
    const seeker = new THREE.Mesh(new THREE.SphereGeometry(.045, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x223040, roughness: .05, metalness: .2, emissive: 0x081420 }));
    seeker.position.y = 5.88; g.add(seeker);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const n = new THREE.Mesh(new THREE.CylinderGeometry(.018, .03, .08, 8), dark); n.position.set(Math.cos(a) * .14, 5.2, Math.sin(a) * .14); n.rotation.z = Math.PI / 2; n.rotation.y = -a; g.add(n); }
    parts.kv = g;
  }
  {
    // 头罩（KV 分离前抛掉，这里与二级一起显示）
    const g = new THREE.Group();
    g.add(lathe([V2(.152, 5.0), V2(.152, 5.3), V2(.08, 5.95), V2(.001, 6.15)], white, 40));
    parts.nose = g;
  }
  const root = new THREE.Group();
  for (const k of ['booster', 'stage2', 'kv', 'nose']) root.add(parts[k]);
  return { root, parts, centers: { booster: 1.5, stage2: 4.0, kv: 5.4 } };
}

// ---------------------------------------------------------------------------
// 海上发射平台（半潜式）。原点：海平面，+Y 向上；发射台中心位于 (0, 12, 0)
// ---------------------------------------------------------------------------
export function buildLaunchPlatform() {
  const g = new THREE.Group();
  const hullT = navalTexture(41, '#8b9196'); hullT.repeat.set(4, 2);
  const deckT = navalTexture(42, '#5c6266'); deckT.repeat.set(6, 4);
  const hull = std({ map: hullT, roughness: .7, metalness: .3 });
  const deck = std({ map: deckT, roughness: .85, metalness: .2 });
  const red = std({ color: 0x8e2f24, roughness: .7 });
  const yellow = std({ color: 0xd8a42a, roughness: .6, metalness: .3 });
  const steel = std({ color: 0x9aa0a4, roughness: .45, metalness: .8 });
  const ox = -18; // 平台几何中心相对发射台偏移
  // 浮筒（水线下）与立柱
  for (const z of [-22, 22]) { const p = new THREE.Mesh(new THREE.BoxGeometry(118, 9, 13), red); p.position.set(ox, -16, z); g.add(p); }
  for (const x of [-38, 0, 38]) for (const z of [-22, 22]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 22, 28), hull); c.position.set(ox + x, -2, z); g.add(c);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(5.45, 5.45, 1.2, 28), yellow); band.position.set(ox + x, 1.5, z); g.add(band);
  }
  // 主甲板
  const d = new THREE.Mesh(new THREE.BoxGeometry(96, 6, 62), hull); d.position.set(ox, 6, 0); g.add(d);
  const dt = new THREE.Mesh(new THREE.BoxGeometry(95.6, .2, 61.6), deck); dt.position.set(ox, 9.05, 0); g.add(dt);
  // 机库与生活区
  const hang = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 46), std({ map: navalTexture(43, '#c9cdd0'), roughness: .6 })); hang.position.set(ox - 30, 17, 0); g.add(hang);
  const heli = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, .6, 40), deck); heli.position.set(ox - 30, 25.3, 0); g.add(heli);
  const hring = new THREE.Mesh(new THREE.TorusGeometry(8, .25, 6, 40), yellow); hring.rotation.x = Math.PI / 2; hring.position.set(ox - 30, 25.7, 0); g.add(hring);
  // 发射台基座与导流槽
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 3, 32, 1, true), steel); ped.position.set(0, 10.5, 0); g.add(ped);
  const pedTop = new THREE.Mesh(new THREE.RingGeometry(1.25, 2.6, 32), steel); pedTop.rotation.x = -Math.PI / 2; pedTop.position.set(0, 12, 0); g.add(pedTop);
  const trench = new THREE.Mesh(new THREE.BoxGeometry(5, .3, 24), std({ color: 0x1a1817, roughness: 1 })); trench.position.set(0, 9.1, 12); g.add(trench);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const arm = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.6, .5), yellow); arm.position.set(Math.cos(a) * 1.25, 12.5, Math.sin(a) * 1.25); g.add(arm); }
  // 勤务塔（桁架）
  const tower = new THREE.Group(), geos = [];
  const H = 26, w = 4;
  for (const [x, z] of [[0, 0], [w, 0], [0, w], [w, w]]) { const b = new THREE.BoxGeometry(.35, H, .35); b.translate(x, H / 2, z); geos.push(b); }
  for (let y = 2; y < H; y += 2.6) {
    for (const [x0, z0, x1, z1] of [[0, 0, w, 0], [0, w, w, w], [0, 0, 0, w], [w, 0, w, w]]) {
      const b = new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0) || .2, .18, .18);
      b.rotateY(-Math.atan2(z1 - z0, x1 - x0)); b.translate((x0 + x1) / 2, y, (z0 + z1) / 2); geos.push(b);
      const diag = new THREE.BoxGeometry(Math.hypot(x1 - x0 + 0, 2.6, z1 - z0), .12, .12);
      const len = Math.hypot(Math.hypot(x1 - x0, z1 - z0), 2.6);
      const dg = new THREE.BoxGeometry(len, .12, .12); dg.rotateZ(Math.atan2(2.6, Math.hypot(x1 - x0, z1 - z0))); dg.rotateY(-Math.atan2(z1 - z0, x1 - x0)); dg.translate((x0 + x1) / 2, y + 1.3, (z0 + z1) / 2); geos.push(dg);
      diag.dispose();
    }
  }
  tower.add(new THREE.Mesh(mergeGeometries(geos), std({ color: 0xc23b22, roughness: .55, metalness: .5 })));
  for (const y of [9, 15, 21]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, .5, 1.2), steel); arm.position.set(-2.2, y, w / 2); tower.add(arm); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, .3, .2) })); lamp.position.set(w / 2, H + .4, w / 2); tower.add(lamp);
  tower.position.set(4.2, 9, -2); g.add(tower);
  // 吊车、天线、栏杆
  const crane = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 28), yellow); crane.position.set(ox - 6, 16, -18); crane.rotation.x = .5; g.add(crane);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.25, .4, 12, 8), steel); mast.position.set(ox - 40, 31, -14); g.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 12, 0, Math.PI * 2, 0, .9), std({ color: 0xf0f0f0, roughness: .4, side: THREE.DoubleSide })); dish.position.set(ox - 40, 27, 14); dish.rotation.x = -.9; g.add(dish);
  const rails = []; for (let x = -66; x <= 30; x += 2) for (const z of [-31, 31]) { const b = new THREE.BoxGeometry(.08, 1.1, .08); b.translate(ox + x + 18, 9.6, z); rails.push(b); }
  g.add(new THREE.Mesh(mergeGeometries(rails), steel));
  // 夜间甲板灯
  const lights = []; for (let x = -60; x <= 20; x += 16) for (const z of [-29, 29]) { const s = new THREE.SphereGeometry(.25, 6, 4); s.translate(x, 10.5, z); lights.push(s); }
  g.add(new THREE.Mesh(mergeGeometries(lights), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.8) })));
  return g;
}

// ---------------------------------------------------------------------------
// 防御舰（示意，通用驱逐舰外形）。原点：前部垂发单元（海平面），+X 船首
// ---------------------------------------------------------------------------
export function buildShip() {
  const g = new THREE.Group();
  const grayT = navalTexture(51, '#7e868c'); grayT.repeat.set(8, 1);
  const gray = std({ map: grayT, roughness: .65, metalness: .35 });
  const deckMat = std({ map: navalTexture(52, '#4a4f53'), roughness: .9, metalness: .2 });
  const dark = std({ color: 0x2c3135, roughness: .5, metalness: .5 });
  const ox = -46;
  // 船体：沿 x 放样
  const xs = [], N = 40;
  for (let i = 0; i <= N; i++) xs.push(-77 + 155 * i / N);
  const prof = (x) => {
    const s = (x + 77) / 155;
    const b = 10 * (s < .62 ? Math.min(1, .82 + s * .6) : Math.sqrt(Math.max(0, 1 - Math.pow((s - .62) / .38, 1.6))));
    const deckH = 8.5 + 3.5 * Math.pow(Math.max(0, s - .5) / .5, 2);
    return { b: Math.max(.05, b), deckH };
  };
  const pos = [], idx = [];
  const ring = [[-1, 1], [-1, .35], [-.75, -.25], [-.3, -.75], [0, -1], [.3, -.75], [.75, -.25], [1, .35], [1, 1]];
  for (const x of xs) {
    const { b, deckH } = prof(x);
    for (const [u, v] of ring) pos.push(x, v > 0 ? v * deckH : v * 7, u * b * (v > 0 ? 1 : (1 + v * .55)));
  }
  const R = ring.length;
  for (let i = 0; i < N; i++) for (let j = 0; j < R - 1; j++) { const a = i * R + j, b2 = a + R; idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setIndex(idx); hg.computeVertexNormals();
  const uv = []; for (let i = 0; i <= N; i++) for (let j = 0; j < R; j++) uv.push(i / N, j / (R - 1)); hg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const hull = new THREE.Mesh(hg, std({ map: grayT, roughness: .65, metalness: .35, side: THREE.DoubleSide })); hull.position.x = ox; g.add(hull);
  // 甲板
  const shape = new THREE.Shape();
  shape.moveTo(-77, -prof(-77).b);
  for (const x of xs) shape.lineTo(x, -prof(x).b);
  for (const x of [...xs].reverse()) shape.lineTo(x, prof(x).b);
  const dg = new THREE.ShapeGeometry(shape); dg.rotateX(Math.PI / 2);
  const dpos = dg.attributes.position; for (let i = 0; i < dpos.count; i++) dpos.setY(i, prof(dpos.getX(i)).deckH);
  dg.computeVertexNormals();
  const deck = new THREE.Mesh(dg, deckMat); deck.position.x = ox; g.add(deck);
  // 上层建筑（带倾斜面的隐身外形）
  const block = (w, h, d, x, y, z, taper = .82, mat = gray) => {
    const geo = new THREE.CylinderGeometry(Math.SQRT1_2 * taper, Math.SQRT1_2, 1, 4, 1); geo.rotateY(Math.PI / 4); geo.scale(w, h, d); geo.translate(0, h / 2, 0); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.position.set(x + ox, y, z); g.add(m); return m;
  };
  block(30, 11, 17, 12, 8.6, 0);
  block(18, 6, 13, 13, 19.6, 0);
  block(24, 9, 15, -22, 8.6, 0);
  // 相控阵雷达面（四面）
  const arr = std({ color: 0x3a4148, roughness: .35, metalness: .6 });
  const octa = new THREE.CircleGeometry(3.3, 8);
  for (const [x, y, ry] of [[22.8, 17, Math.PI / 4], [22.8, 17, -Math.PI / 4]]) {
    const m = new THREE.Mesh(octa, arr); m.position.set(x + ox - 4, y, ry > 0 ? -5.5 : 5.5); m.rotation.y = ry > 0 ? Math.PI / 2 - .78 : Math.PI / 2 + .78; m.rotation.x = 0; g.add(m);
  }
  for (const z of [-1, 1]) { const m = new THREE.Mesh(octa, arr); m.position.set(-28 + ox, 14, z * 6.4); m.rotation.y = z > 0 ? -.5 : Math.PI + .5; g.add(m); }
  // 桅杆
  const mastG = new THREE.CylinderGeometry(.6, 1.8, 16, 4); mastG.rotateY(Math.PI / 4);
  const mast = new THREE.Mesh(mastG, gray); mast.position.set(8 + ox, 33, 0); g.add(mast);
  for (const y of [36, 39]) { const yard = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, 9 - (y - 36)), dark); yard.position.set(8 + ox, y, 0); g.add(yard); }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 10), std({ color: 0xdedede, roughness: .5 })); dome.position.set(8 + ox, 41.6, 0); g.add(dome);
  // 烟囱
  for (const x of [-4, -16]) block(5, 7, 4.5, x, 17.6, 0, .7, gray);
  // 垂发单元（前、后）
  const vls = std({ color: 0x353a3e, roughness: .7, metalness: .4 });
  const cells = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { const b = new THREE.BoxGeometry(1.6, .12, 1.6); b.translate(-2.4 + i * 1.75 - 4.8, 0, -3.3 + j * 1.75 + .7); cells.push(b); }
  const vlsF = new THREE.Mesh(mergeGeometries(cells), vls); vlsF.position.set(4.8, prof(46).deckH + .07, -.5); g.add(vlsF);
  const vlsA = vlsF.clone(); vlsA.position.set(-80 + 4.8 + 1, prof(-34).deckH + .07, -.5); g.add(vlsA);
  // 舰炮
  const gun = new THREE.Group();
  const tur = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 2.2, 6), gray); tur.position.y = 1.1; gun.add(tur);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 7, 10), dark); barrel.rotation.z = Math.PI / 2 - .12; barrel.position.set(3.6, 1.8, 0); gun.add(barrel);
  gun.position.set(60 + ox, prof(60).deckH, 0); g.add(gun);
  // 舷号
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8ecee'; ctx.font = 'bold 96px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('07', 128, 100);
  const ht = new THREE.CanvasTexture(c); ht.colorSpace = THREE.SRGBColorSpace;
  for (const z of [-1, 1]) { const num = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: ht, transparent: true, roughness: .6 })); num.position.set(52 + ox, 7, z * (prof(52).b + .05)); num.rotation.y = z > 0 ? 0 : Math.PI; g.add(num); }
  // 航行灯
  const navL = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.5) })); navL.position.set(8 + ox, 43, 0); g.add(navL);
  return g;
}

// ---------------------------------------------------------------------------
// 预警卫星（地球静止轨道）。-Y 指向地心
// ---------------------------------------------------------------------------
export function buildSatellite() {
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 2.4), std({ map: mliTexture(), roughness: .3, metalness: .95 })); g.add(bus);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(.75, .75, 2.2, 32, 1, true), std({ color: 0xe8e8e8, roughness: .5, side: THREE.DoubleSide })); scope.position.y = -2.6; g.add(scope);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(.72, 32), std({ color: 0x10141c, roughness: .05, metalness: .3 })); lens.rotation.x = Math.PI / 2; lens.position.y = -3.3; g.add(lens);
  const st = solarTexture();
  for (const s of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 2.2, 8), std({ color: 0xaaaaaa, metalness: .8, roughness: .3 })); boom.rotation.z = Math.PI / 2; boom.position.x = s * 2.3; g.add(boom);
    for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(3, .05, 2.4), std({ map: st, roughness: .25, metalness: .6 })); p.position.x = s * (4.9 + k * 3.1); g.add(p); }
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, .8), std({ color: 0xf2f2f2, roughness: .4, side: THREE.DoubleSide })); dish.position.set(0, 2.2, 0); g.add(dish);
  return g;
}
