// 三自由度质点飞行仿真（ECI 惯性系积分，ECEF 记录）。
// 参数为通用教学量级，不对应任何现实型号；程序角为固定开环程序，
// 落点由动力学自然给出，不包含任何“瞄准/制导解算”。
import { atmosphere, gravity, table, geodeticToEcef, ecefToGeodetic, centralAngle, RE, OMEGA, G0, P0 } from './environment.js';

export const SCENARIO = {
  // 虚构太平洋试验场：海上发射平台 → 开阔海域落区
  launch: { lat: 34.6, lon: 163.2 },
  azimuth: 96.5,          // 发射方位角 °（自北顺时针）
  pitchKick: 13,          // 初始转弯角 °（保持至速度矢量对齐）
  upperPitchEnd: 5,       // 二级关机时程序俯仰角 °（相对当地水平）
  upperPitchDrop: 6,      // 三级工作期间俯仰角继续下压量 °
  sunLocalHour: 17.3,     // 发射点地方太阳时
  sunDeclination: 9,      // 太阳赤纬 °
  interceptAlt: 64,       // 末段高层交会高度 km
  prelaunch: 15,          // 时间轴从 T-15 s 开始
};

// 通用三级固体运载器（教学量级）
export const VEHICLE = {
  stages: [
    { key: 's1', name: '一级', dry: 2300, prop: 20800, ispSL: 252, ispVac: 280, burn: 61, dia: 1.84, len: 7.4 },
    { key: 's2', name: '二级', dry: 880, prop: 7300, ispSL: 250, ispVac: 291, burn: 63, dia: 1.42, len: 4.5 },
    { key: 's3', name: '三级', dry: 360, prop: 2750, ispSL: 250, ispVac: 293, burn: 58, dia: 1.24, len: 2.5 },
  ],
  shroud: { mass: 170, jettisonAlt: 92 },
  pbv: { dry: 380, prop: 70, thrust: 1800, isp: 228 },     // 末助推舱
  rv: { mass: 360, dia: 0.56, noseRadius: 0.035 },           // 再入体
  sepCoast: 1.1,
};

const CD_STACK = [[0, .30], [.8, .31], [1.0, .50], [1.2, .55], [1.5, .48], [2, .40], [3, .31], [5, .25], [10, .22]];
const CD_RV = [[0, .42], [.8, .46], [1.05, .78], [1.4, .62], [2.5, .34], [5, .22], [10, .18], [30, .16]];
const CD_TUMBLE = [[0, 1.1], [1, 1.4], [3, 1.2], [10, 1.0]];

// 固体发动机推力形状：点火爬升、平台略递减、拖尾
function thrustShape(tau) {
  if (tau < 0 || tau > 1) return 0;
  if (tau < .025) return tau / .025;
  if (tau > .92) return Math.max(0, Math.cos((tau - .92) / .08 * Math.PI / 2));
  return 1.06 - .12 * tau;
}
const SHAPE_MEAN = (() => { let s = 0; for (let i = 0; i < 2000; i++) s += thrustShape((i + .5) / 2000); return s / 2000; })();

// ---------- 小型向量工具 ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function eciToEcef(t, r) {
  const c = Math.cos(OMEGA * t), s = Math.sin(OMEGA * t);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
}
const relVel = (r, v) => [v[0] + OMEGA * r[1], v[1] - OMEGA * r[0], v[2]];

// ---------- 轨迹记录器 ----------
class Track {
  constructor(name, extra = []) { this.name = name; this.t = []; this.p = []; this.v = []; this.ax = []; this.extra = extra; for (const k of extra) this[k] = []; }
  push(t, r, v, axis, data = {}) {
    this.t.push(t);
    const pe = eciToEcef(t, r), ve = eciToEcef(t, relVel(r, v)), ae = eciToEcef(t, axis);
    this.p.push(...pe); this.v.push(...ve); this.ax.push(...ae);
    for (const k of this.extra) this[k].push(data[k] ?? 0);
  }
  get t0() { return this.t[0]; }
  get t1() { return this.t[this.t.length - 1]; }
  finalize() {
    this.t = Float64Array.from(this.t); this.p = Float64Array.from(this.p); this.v = Float64Array.from(this.v); this.ax = Float32Array.from(this.ax);
    for (const k of this.extra) this[k] = Float32Array.from(this[k]);
    return this;
  }
  index(t) {
    const T = this.t; let lo = 0, hi = T.length - 1;
    if (t <= T[0]) return 0; if (t >= T[hi]) return hi - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo;
  }
  /** 三次 Hermite 插值 ECEF 位置（km），out 为长度 3 数组 */
  position(t, out = [0, 0, 0]) {
    const i = this.index(t), T = this.t, P = this.p, V = this.v;
    const h = T[i + 1] - T[i], s = Math.min(1, Math.max(0, (t - T[i]) / h));
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (let k = 0; k < 3; k++) out[k] = h00 * P[3 * i + k] + h10 * h * V[3 * i + k] + h01 * P[3 * i + 3 + k] + h11 * h * V[3 * i + 3 + k];
    return out;
  }
  lerp(arr, t, stride = 1, out) {
    const i = this.index(t), T = this.t, s = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i])));
    if (stride === 1) return arr[i] + (arr[i + 1] - arr[i]) * s;
    for (let k = 0; k < stride; k++) out[k] = arr[stride * i + k] + (arr[stride * i + stride + k] - arr[stride * i + k]) * s;
    return out;
  }
  velocity(t, out = [0, 0, 0]) { return this.lerp(this.v, t, 3, out); }
  axis(t, out = [0, 0, 0]) { this.lerp(this.ax, t, 3, out); return out; }
  get(key, t) { return this.lerp(this[key], t); }
  pointAt(i) { return [this.p[3 * i], this.p[3 * i + 1], this.p[3 * i + 2]]; }
}

// ---------- RK4 ----------
function rk4(t, r, v, m, dt, deriv) {
  const k1 = deriv(t, r, v, m);
  const r2 = add(r, v, dt / 2), v2 = add(v, k1.a, dt / 2);
  const k2 = deriv(t + dt / 2, r2, v2, m + k1.mdot * dt / 2);
  const r3 = add(r, v2, dt / 2), v3 = add(v, k2.a, dt / 2);
  const k3 = deriv(t + dt / 2, r3, v3, m + k2.mdot * dt / 2);
  const r4 = add(r, v3, dt), v4 = add(v, k3.a, dt);
  const k4 = deriv(t + dt, r4, v4, m + k3.mdot * dt);
  const nr = [0, 0, 0], nv = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    nr[i] = r[i] + dt / 6 * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
    nv[i] = v[i] + dt / 6 * (k1.a[i] + 2 * k2.a[i] + 2 * k3.a[i] + k4.a[i]);
  }
  return { r: nr, v: nv, m: m + dt / 6 * (k1.mdot + 2 * k2.mdot + 2 * k3.mdot + k4.mdot), d: k1 };
}

const g = [0, 0, 0];
function aero(r, v, m, cdTab, area) {
  const h = len(r) - RE, atm = atmosphere(h), vr = relVel(r, v), vm = len(vr) * 1000;
  const mach = vm / atm.a, q = .5 * atm.rho * vm * vm;
  const D = q * table(cdTab, mach) * area;               // N
  const aD = vm > 0 ? scale(vr, -D / m / (vm)) : [0, 0, 0]; // km/s^2（vr km/s → 除以 vm m/s 得到单位向量×1e-3）
  return { aD, h, atm, mach, q, D, vr };
}

/** 被动体（废弃级、整流罩、碎片、再入体）弹道积分 */
function simulatePassive(name, t0, r, v, opt) {
  const { mass, area, cd = CD_TUMBLE, tMax = 4000, stopAlt = 0, rec = .5, extra = [], axisMode = 'vel', rn = .5, dtLow = .02 } = opt;
  const tr = new Track(name, extra);
  let t = t0, axis = norm(v), lastRec = -1e9;
  const deriv = (tt, rr, vv, mm) => {
    gravity(rr[0], rr[1], rr[2], g);
    const A = aero(rr, vv, mm, cd, area);
    return { a: [g[0] + A.aD[0], g[1] + A.aD[1], g[2] + A.aD[2]], mdot: 0, A };
  };
  while (t < t0 + tMax) {
    const h = len(r) - RE;
    const dt = h < 140 ? dtLow : h < 400 ? .2 : 1;
    const recDt = h < 140 ? Math.min(rec, .1) : rec;
    const s = rk4(t, r, v, mass, dt, deriv);
    if (t - lastRec >= recDt - 1e-9 || t === t0) {
      const A = s.d.A, vm = len(A.vr) * 1000;
      if (axisMode === 'vel') axis = norm(A.vr.map(x => x || 1e-9));
      tr.push(t, r, v, axis, {
        h: A.h, mach: A.mach, q: A.q, g: A.D / mass / G0, mass,
        heat: 1.7415e-4 * Math.sqrt(A.atm.rho / rn) * vm ** 3 / 1e6, // MW/m^2（Sutton–Graves）
        speed: len(v), rel: vm / 1000,
      });
      lastRec = t;
    }
    r = s.r; v = s.v; t += dt;
    if (len(r) - RE <= stopAlt) { break; }
  }
  // 末点落在停止高度上
  const A = deriv(t, r, v, mass).A;
  tr.push(t, r, v, norm(A.vr), { h: A.h, mach: A.mach, q: A.q, g: A.D / mass / G0, mass, speed: len(v), rel: len(A.vr) });
  tr.endReason = len(r) - RE <= stopAlt ? 'ground' : 'timeout';
  return tr.finalize();
}

/** 主仿真：返回各物体轨迹与事件 */
export function runFlight(sc = SCENARIO, veh = VEHICLE) {
  const S = veh.stages, events = [];
  const ev = (t, key, label, detail = '') => events.push({ t, key, label, detail });
  const site = geodeticToEcef(sc.launch.lat, sc.launch.lon, 0.012);
  const up0 = norm(site), east0 = norm(cross([0, 0, 1], up0)), north0 = cross(up0, east0);
  const az = sc.azimuth * Math.PI / 180;
  const head0 = add(scale(north0, Math.cos(az)), east0, Math.sin(az));

  // 时序
  const tIgn = [0], tBo = [S[0].burn];
  for (let i = 1; i < S.length; i++) { tIgn[i] = tBo[i - 1] + veh.sepCoast; tBo[i] = tIgn[i] + S[i].burn; }
  const tVert = 6.5, tKick = 7;
  const tPbvBurn = tBo[2] + 24, pbvBurnDur = veh.pbv.prop * veh.pbv.isp * G0 / veh.pbv.thrust;
  const tRelease = tPbvBurn + pbvBurnDur + 55;

  const payload = veh.shroud.mass + veh.pbv.dry + veh.pbv.prop + veh.rv.mass;
  let m = S.reduce((s, x) => s + x.dry + x.prop, 0) + payload;
  const m0 = m;
  let r = site.slice(), v = cross([0, 0, OMEGA], r);
  let t = 0, stageMass = [...S.map(x => x.dry)];
  let shroudOn = true, theta2 = null, gtStart = null, holdAxis = up0.slice();
  let telem = {};

  const ctrl = (tt, rr, vv, mm) => {
    // 返回推力方向、推力、质量流率、参考面积
    let stage = -1, tau = 0;
    for (let i = 0; i < S.length; i++) if (tt >= tIgn[i] && tt < tBo[i]) { stage = i; tau = (tt - tIgn[i]) / S[i].burn; }
    const up = norm(rr), A = aero(rr, vv, mm, CD_STACK, Math.PI * (S[Math.max(0, stage === -1 ? bottom(tt) : stage)].dia / 2) ** 2);
    let dir = holdAxis, thrust = 0, mdot = 0;
    if (stage >= 0) {
      const st = S[stage], shape = thrustShape(tau) / SHAPE_MEAN;
      mdot = -st.prop / st.burn * shape;
      const isp = st.ispVac - (st.ispVac - st.ispSL) * Math.min(1, A.atm.p / P0);
      thrust = -mdot * isp * G0;
      if (tt < tVert) dir = up;
      else if (tt < tVert + tKick) {
        const k = (tt - tVert) / tKick * sc.pitchKick * Math.PI / 180;
        dir = norm(add(scale(up, Math.cos(k)), horiz(up, head0), Math.sin(k)));
      } else if (stage === 0) {
        // 保持转弯姿态，直到速度矢量倾斜到转弯角后进入零攻角重力转弯
        dir = gtStart !== null && tt >= gtStart ? norm(A.vr) : kickDir(up);
      } else {
        const k = Math.min(1, (tt - tIgn[1]) / (tBo[1] - tIgn[1]));
        const th = (stage === 1 ? theta2 + (sc.upperPitchEnd - theta2) * k : sc.upperPitchEnd - (tt - tIgn[2]) / S[2].burn * sc.upperPitchDrop) * Math.PI / 180;
        dir = norm(add(scale(up, Math.sin(th)), horiz(up, vv), Math.cos(th)));
      }
    } else if (tt >= tPbvBurn && tt < tPbvBurn + pbvBurnDur) {
      mdot = -veh.pbv.prop / pbvBurnDur; thrust = veh.pbv.thrust; dir = norm(vv);
    }
    return { dir, thrust, mdot, A, stage };
  };
  const kickDir = up => { const k = sc.pitchKick * Math.PI / 180; return norm(add(scale(up, Math.cos(k)), horiz(up, head0), Math.sin(k))); };
  const bottom = tt => tt < tIgn[1] ? 0 : tt < tIgn[2] ? 1 : 2;
  function horiz(up, vec) { const h = add(vec, up, -dot(vec, up)); return norm(h); }

  const deriv = (tt, rr, vv, mm) => {
    const c = ctrl(tt, rr, vv, mm);
    gravity(rr[0], rr[1], rr[2], g);
    const aT = c.thrust / mm / 1000;
    return { a: [g[0] + c.A.aD[0] + c.dir[0] * aT, g[1] + c.A.aD[1] + c.dir[1] * aT, g[2] + c.A.aD[2] + c.dir[2] * aT], mdot: c.mdot, c };
  };

  const main = new Track('主飞行体', ['h', 'mach', 'q', 'g', 'mass', 'thrust', 'speed', 'rel', 'stage', 'heat', 'gamma']);
  const spent = [];
  const boundaries = [tVert, tVert + tKick, ...tIgn.slice(1), ...tBo, tPbvBurn, tPbvBurn + pbvBurnDur, tRelease];
  let lastRec = -1, maxQ = { q: 0 }, maxG = { g: 0 };
  ev(0, 'liftoff', '点火起飞', '三级固体运载器离台');

  const record = (tt, rr, vv, mm, c, aMag) => {
    const vr = c.A.vr, up = norm(rr);
    const gamma = Math.asin(Math.max(-1, Math.min(1, dot(norm(vv), up)))) * 180 / Math.PI;
    main.push(tt, rr, vv, c.thrust > 0 ? c.dir : holdAxis, {
      h: c.A.h, mach: c.A.mach, q: c.A.q, g: aMag, mass: mm, thrust: c.thrust, speed: len(vv), rel: len(vr),
      stage: c.thrust > 0 ? (c.stage >= 0 ? c.stage : 3) : -1, heat: 0, gamma,
    });
  };

  while (t < tRelease - 1e-9) {
    const thrusting = t < tBo[2] || (t >= tPbvBurn && t < tPbvBurn + pbvBurnDur);
    let dt = thrusting ? .02 : .25;
    const nb = boundaries.find(b => b > t + 1e-9);
    if (nb !== undefined && t + dt > nb) dt = nb - t;
    const recDt = thrusting || len(r) - RE < 120 ? .1 : 1;
    const d0 = deriv(t, r, v, m);
    if (t - lastRec >= recDt - 1e-9) {
      const aMag = (d0.c.thrust - d0.c.A.D) / m / G0;
      record(t, r, v, m, d0.c, aMag); lastRec = t;
      if (d0.c.A.q > maxQ.q && t < tBo[0]) maxQ = { q: d0.c.A.q, t, h: d0.c.A.h, mach: d0.c.A.mach };
      if (aMag > maxG.g) maxG = { g: aMag, t };
    }
    if (d0.c.thrust > 0) holdAxis = d0.c.dir;
    const s = rk4(t, r, v, m, dt, deriv);
    r = s.r; v = s.v; m = s.m; t += dt;
    if (gtStart === null && t > tVert + tKick) {
      const vr = relVel(r, v), ang = Math.acos(dot(norm(vr), norm(r))) * 180 / Math.PI;
      if (ang >= sc.pitchKick || t > 40) gtStart = t;
    }

    // 离散事件
    for (let i = 0; i < S.length; i++) {
      if (Math.abs(t - tBo[i]) < 1e-6 && stageMass[i] !== null) {
        // 分离：抛掉干重（残余推进剂计入干重），弹簧/反推产生小分离速度
        const sepV = add(v, norm(v), -0.004);
        spent.push({ key: S[i].key, name: S[i].name + '残骸', t0: t, r: r.slice(), v: sepV, mass: stageMass[i], area: S[i].dia * S[i].len, stage: i });
        m -= stageMass[i]; stageMass[i] = null;
        const h = len(r) - RE;
        ev(t, `sep${i + 1}`, `${S[i].name}关机分离`, `高度 ${h.toFixed(0)} km · 速度 ${len(v).toFixed(2)} km/s`);
        if (i < S.length - 1) ev(t + veh.sepCoast, `ign${i + 2}`, `${S[i + 1].name}点火`, '');
        if (i === 0) theta2 = Math.asin(dot(norm(v), norm(r))) * 180 / Math.PI;
      }
    }
    if (shroudOn && len(r) - RE > veh.shroud.jettisonAlt) {
      shroudOn = false; m -= veh.shroud.mass;
      const side = norm(cross(v, r));
      [1, -1].forEach((sg, k) => spent.push({ key: 'shroud' + k, name: '整流罩', t0: t, r: r.slice(), v: add(add(v, side, .006 * sg), norm(v), -.002), mass: veh.shroud.mass / 2, area: 3, small: true }));
      ev(t, 'shroud', '整流罩分离', `高度 ${(len(r) - RE).toFixed(0)} km，气动加热已可忽略`);
    }
  }
  const bo = main.t.length - 1;
  
  ev(tPbvBurn, 'pbv', '末助推舱调姿/变轨', `小推力 ${veh.pbv.thrust / 1000} kN，持续 ${pbvBurnDur.toFixed(0)} s`);
  ev(tRelease, 'release', '再入体释放', '末助推舱后撤');
  record(t, r, v, m, deriv(t, r, v, m).c, 0);
  main.finalize();

  // 末助推舱：释放后后撤并最终在高层大气烧毁
  const pbvTrack = simulatePassive('末助推舱', tRelease, r, add(v, norm(v), -.0015), { mass: veh.pbv.dry, area: 2.2, stopAlt: 75, tMax: 3000, rec: 2 });
  // 再入体
  const rvArea = Math.PI * (veh.rv.dia / 2) ** 2;
  const rvTrack = simulatePassive('再入体', tRelease, r, add(v, norm(v), .0008), {
    mass: veh.rv.mass, area: rvArea, cd: CD_RV, stopAlt: 0, tMax: 3000, rec: 1, rn: veh.rv.noseRadius,
    extra: ['h', 'mach', 'q', 'g', 'mass', 'speed', 'rel', 'heat'],
  });
  const spentTracks = spent.map(s => Object.assign(simulatePassive(s.name, s.t0, s.r, s.v, { mass: s.mass, area: s.area, stopAlt: 0, tMax: 3000, rec: s.small ? .5 : 1, axisMode: 'tumble' }), { key: s.key, stage: s.stage, small: !!s.small }));

  // 关键量统计
  let apogee = { h: 0 }, reentry = null, peakHeat = { heat: 0 }, peakG = { g: 0 };
  for (let i = 0; i < rvTrack.t.length; i++) {
    const h = rvTrack.h[i], tt = rvTrack.t[i];
    if (h > apogee.h) apogee = { h, t: tt };
    if (!reentry && tt > apogee.t && h < 100) reentry = { t: tt, speed: rvTrack.speed[i], rel: rvTrack.rel[i], gamma: 0 };
    if (rvTrack.heat[i] > peakHeat.heat) peakHeat = { heat: rvTrack.heat[i], t: tt, h };
    if (rvTrack.g[i] > peakG.g) peakG = { g: rvTrack.g[i], t: tt, h };
  }
  if (reentry) {
    const i = rvTrack.index(reentry.t), p = rvTrack.pointAt(i), vv = [rvTrack.v[3 * i], rvTrack.v[3 * i + 1], rvTrack.v[3 * i + 2]];
    reentry.gamma = Math.asin(dot(norm(vv), norm(p))) * 180 / Math.PI;
  }
  const impactP = rvTrack.pointAt(rvTrack.t.length - 1);
  const impact = { ...ecefToGeodetic(impactP), t: rvTrack.t1, p: impactP, range: centralAngle(site, impactP) * RE };
  const boState = { t: tBo[2], speed: main.get('speed', tBo[2] - .05), h: main.get('h', tBo[2] - .05), gamma: main.get('gamma', tBo[2] - .05) };

  ev(tBo[2] + .01, 'boEnd', '助推段结束', `关机速度 ${boState.speed.toFixed(2)} km/s · 弹道倾角 ${boState.gamma.toFixed(1)}°`);
  ev(apogee.t, 'apogee', '弹道顶点', `高度 ${apogee.h.toFixed(0)} km`);
  if (reentry) ev(reentry.t, 'reentry', '再入大气层', `100 km 界面 · ${reentry.speed.toFixed(2)} km/s · 倾角 ${reentry.gamma.toFixed(1)}°`);
  if (maxQ.t) ev(maxQ.t, 'maxq', '最大动压', `${(maxQ.q / 1000).toFixed(1)} kPa @ ${maxQ.h.toFixed(1)} km, Ma ${maxQ.mach.toFixed(2)}`);

  return {
    sc, veh, site, events, main, rv: rvTrack, pbv: pbvTrack, spent: spentTracks,
    stats: { m0, maxQ, maxG, apogee, reentry, peakHeat, peakG, impact, burnout: boState, tRelease, tBo, tIgn },
  };
}

export { Track, simulatePassive, CD_TUMBLE, norm, cross, dot, add, scale, len, eciToEcef, relVel };
