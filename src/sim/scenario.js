// 场景编排：在飞行仿真结果之上，布置防御单元、传感器几何与拦截弹的可视化运动。
// 拦截弹运动为“预定交会点”的运动学曲线（教学演示），不是制导律。
import { runFlight, simulatePassive, Track, norm, cross, dot, add, scale, len } from './flight.js';
import { geodeticToEcef, ecefToGeodetic, RE, OMEGA } from './environment.js';

const GEO_R = 42164;

// 在 ECEF 中构造被动体轨迹所需的 ECI 初值（t 时刻）
function ecefToEci(t, p, vRel) {
  const c = Math.cos(OMEGA * t), s = Math.sin(OMEGA * t);
  const r = [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
  const vr = [c * vRel[0] - s * vRel[1], s * vRel[0] + c * vRel[1], vRel[2]];
  return { r, v: [vr[0] - OMEGA * r[1], vr[1] + OMEGA * r[0], vr[2]] };
}
const onSurface = (p, h = 0) => scale(norm(p), RE + h);

// 伪随机（可复现）
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

/** 拦截弹速度剖面（km/s）：两级助推 + 惯性滑行 */
function interceptorSpeed(t) {
  if (t < 0) return 0;
  if (t < 4.5) return .03 + 1.30 * (t / 4.5) ** 1.25;
  if (t < 5.3) return 1.33;
  if (t < 14.5) return 1.33 + 1.42 * ((t - 5.3) / 9.2);
  return Math.max(2.35, 2.75 - (t - 14.5) * .012);
}

function bezier(p0, p1, p2, p3, s) {
  const u = 1 - s, a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
  return [0, 1, 2].map(k => a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k]);
}

export function buildScenario() {
  const f = runFlight();
  const { sc, stats, rv } = f;
  const events = f.events;
  const ev = (t, key, label, detail = '', side = 'off') => events.push({ t, key, label, detail, side });

  // ---- 交会点：再入体下降穿过设定高度 ----
  let tI = stats.impact.t - 5;
  for (let i = rv.index(stats.apogee.t); i < rv.t.length; i++) if (rv.h[i] < sc.interceptAlt) { tI = rv.t[i]; break; }
  const PI = rv.position(tI), VI = rv.velocity(tI);
  const upI = norm(PI), along = norm(add(VI, upI, -dot(VI, upI))), crossT = norm(cross(upI, along));
  const ground = onSurface(PI);

  // ---- 海上防御单元：位于交会点地面投影下游偏侧 ----
  const ship = onSurface(add(add(ground, along, 30), crossT, 34), 0);
  const shipUp = norm(ship), shipNorth = norm(add([0, 0, 1], shipUp, -shipUp[2])), shipEast = cross(shipNorth, shipUp);
  const radar = add(ship, shipUp, .028);
  const radarRange = 1350;

  // ---- 雷达可视性：视线高于海平面以上 0.5° 且在作用距离内 ----
  const radarSees = (p) => {
    const d = add(p, radar, -1), r = len(d);
    const el = Math.asin(dot(d, shipUp) / r) * 180 / Math.PI;
    return r < radarRange && el > .5 ? { r, el } : null;
  };
  let tAcq = null;
  for (let t = stats.tRelease; t < tI; t += .5) if (radarSees(rv.position(t))) { tAcq = t; break; }
  tAcq ??= tI - 160;

  // ---- 拦截弹运动学曲线 ----
  const P0 = add(ship, shipUp, .012);
  const chord = len(add(PI, P0, -1));
  const tEnd = norm(add(scale(norm(VI), -.55), upI, .6));
  const P1 = add(P0, shipUp, chord * .5), P2 = add(PI, tEnd, -chord * .38);
  const N = 600, cum = [0], pts = [P0];
  for (let i = 1; i <= N; i++) { const p = bezier(P0, P1, P2, PI, i / N); pts.push(p); cum.push(cum[i - 1] + len(add(p, pts[i - 1], -1))); }
  const L = cum[N];
  let flyT = 0, dist = 0; while (dist < L) { dist += interceptorSpeed(flyT) * .01; flyT += .01; }
  const tL = tI - flyT;
  const itc = new Track('拦截弹', ['speed', 'thrust', 'stage']);
  {
    let d = 0, j = 0, prev = P0;
    for (let tt = 0; tt <= flyT + .05; tt += .05) {
      d = Math.min(L, d + interceptorSpeed(tt) * .05);
      while (j < N - 1 && cum[j + 1] < d) j++;
      const s = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      const p = add(pts[j], add(pts[j + 1], pts[j], -1), s);
      const tan = norm(add(pts[j + 1], pts[j], -1));
      const sp = interceptorSpeed(tt);
      itc.t.push(tL + tt); itc.p.push(...p); itc.v.push(...scale(tan, sp)); itc.ax.push(...tan);
      itc.speed.push(sp); itc.thrust.push(tt < 4.5 ? 1 : tt > 5.3 && tt < 14.5 ? 1 : 0); itc.stage.push(tt < 4.8 ? 0 : tt < flyT - 9 ? 1 : 2);
      prev = p;
    }
    itc.finalize();
  }
  const tKV = tL + flyT - 9;

  // 拦截弹抛掉的助推器、二级（被动下落）
  const dropped = [];
  for (const [tt, name, mass, area] of [[tL + 4.8, '拦截弹助推器', 240, 1.2], [tKV, '拦截弹二级', 90, .6]]) {
    const p = itc.position(tt), v = itc.velocity(tt), s = ecefToEci(tt, p, add(v, norm(v), -.01));
    dropped.push(Object.assign(simulatePassive(name, tt, s.r, s.v, { mass, area, stopAlt: 0, tMax: 600, rec: .2, axisMode: 'tumble' }), { key: name }));
  }

  // ---- 交会后碎片 ----
  const rand = rng(20261001), debris = [];
  const vRV = rv.velocity(tI);
  for (let i = 0; i < 26; i++) {
    const dir = norm([rand() - .5, rand() - .5, rand() - .5]);
    const spread = .12 + rand() * .35;
    const vv = add(scale(vRV, .86 + rand() * .1), dir, spread);
    const s = ecefToEci(tI, PI, vv);
    const mass = 2 + rand() * 30;
    debris.push(simulatePassive('碎片', tI, s.r, s.v, { mass, area: .02 + rand() * .25, stopAlt: 0, tMax: 150, rec: .1, axisMode: 'tumble', dtLow: .05 }));
  }

  // ---- 预警卫星（地球静止轨道，经度在发射区附近） ----
  const satLon = sc.launch.lon + 14;
  const sat = geodeticToEcef(0, satLon, GEO_R - RE);
  let tDetect = null;
  for (let t = 1; t < stats.tBo[2]; t += .5) if (f.main.get('h', t) > 9) { tDetect = t + 4; break; }

  // ---- 太阳方向（t=0 时 ECEF；场景中太阳在惯性系固定） ----
  const sunLon = sc.launch.lon - (sc.sunLocalHour - 12) * 15;
  const sunDir = norm(geodeticToEcef(sc.sunDeclination, sunLon, 0));

  const tTrack = tAcq + 9, tDecision = Math.max(tTrack + 20, tL - 25);
  ev(tDetect, 'detect', '天基红外告警', '助推段尾焰穿出云层，红外特征被捕获', 'def');
  ev(stats.tBo[2] + 6, 'irLost', '红外特征消失', '助推结束，转入雷达预测', 'def');
  ev(tAcq, 'acq', '雷达截获', `再入体越过雷达视距 · 距离 ${radarSees(rv.position(tAcq + .5))?.r.toFixed(0) ?? '—'} km`, 'def');
  ev(tTrack, 'track', '稳定跟踪', '航迹起始，滤波收敛', 'def');
  ev(tDecision, 'decide', '交战决策', '预测交会点与发射窗口计算完成', 'def');
  ev(tL, 'launchInt', '拦截弹发射', `垂直发射 · 飞行 ${flyT.toFixed(0)} s`, 'def');
  ev(tL + 4.8, 'intBoost', '拦截弹助推器分离', '', 'def');
  ev(tKV, 'kv', '动能杀伤器分离', '末段寻的（概念演示）', 'def');
  ev(tI, 'intercept', '交会', `高度 ${sc.interceptAlt} km · 相对速度 ${len(add(VI, itc.velocity(tI - .05), -1)).toFixed(1)} km/s`, 'def');
  events.sort((a, b) => a.t - b.t);

  const t0 = -sc.prelaunch, t1 = tI + 110;
  const phases = [
    { key: 'pre', name: '发射准备', en: 'PRELAUNCH', start: t0, end: 0 },
    { key: 'boost', name: '助推段', en: 'BOOST', start: 0, end: stats.tBo[2] },
    { key: 'pbv', name: '末助推段', en: 'POST-BOOST', start: stats.tBo[2], end: stats.tRelease },
    { key: 'mid', name: '中段飞行', en: 'MIDCOURSE', start: stats.tRelease, end: tAcq },
    { key: 'track', name: '跟踪与决策', en: 'TRACK', start: tAcq, end: tL },
    { key: 'intercept', name: '再入与交会', en: 'INTERCEPT', start: tL, end: tI + 4 },
    { key: 'assess', name: '结果评估', en: 'ASSESS', start: tI + 4, end: t1 },
  ];

  return {
    ...f, events, phases, t0, t1,
    defense: { ship, shipUp, shipNorth, shipEast, radar, radarRange, radarSees, tAcq, tTrack, tDecision, tL, tI, tKV, PI, flyT, interceptor: itc, dropped, debris },
    sat: { p: sat, lon: satLon, tDetect },
    sunDir,
    impactGeo: ecefToGeodetic(stats.impact.p),
  };
}
