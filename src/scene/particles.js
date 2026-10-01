// 由仿真轨迹预生成确定性粒子（烟迹、发射场烟云、再入电离尾迹、碎片火花）
import * as THREE from 'three';
import { RE } from '../sim/environment.js';

export const toThree = (p, out = new THREE.Vector3()) => out.set(p[0], p[2], -p[1]);

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

/** 风场（随高度切变），返回 three 坐标下的 km/s */
function wind(pos, h, r) {
  const up = pos.clone().normalize(), east = new THREE.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east);
  const spd = 4 + 26 * Math.exp(-(((h - 11) / 5) ** 2)) + 18 * Math.exp(-(((h - 48) / 14) ** 2)) + 6 * (r() - .5);
  const ang = .4 + h * .09 + (r() - .5) * .4;
  return east.multiplyScalar(Math.cos(ang) * spd / 1000).add(north.multiplyScalar(Math.sin(ang) * spd / 1000)).add(up.multiplyScalar((r() - .3) * .002));
}

const P = [0, 0, 0], A = [0, 0, 0];

/** 主飞行体烟迹 + 发射烟云 */
export function exhaustSmoke(S, anchor, nozzleOffsets) {
  const r = rng(7), out = [], main = S.main, tBo = S.stats.tBo;
  const pos = new THREE.Vector3(), ax = new THREE.Vector3();
  let last = null;
  for (let t = 0.05; t < tBo[1]; t += .01) {
    const thrust = main.get('thrust', t);
    if (thrust < 1e4) { last = null; continue; }
    const h = main.get('h', t);
    if (h > 78) break;
    toThree(main.position(t, P), pos); toThree(main.axis(t, A), ax);
    const stage = t < tBo[0] ? 0 : 1;
    pos.addScaledVector(ax, nozzleOffsets[stage] / 1000);
    const s0 = (.0035 + .0009 * h + .00003 * h * h) * (stage ? .7 : 1);
    const spacing = Math.max(.0018, s0 * .32);
    if (last && pos.distanceTo(last) < spacing) continue;
    last = pos.clone();
    const n = 1 + (h < 2 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const jitter = new THREE.Vector3(r() - .5, r() - .5, r() - .5).multiplyScalar(s0 * .5);
      out.push({
        p: pos.clone().add(jitter).sub(anchor).toArray(), t,
        v: wind(pos, h, r).toArray(), s0: s0 * (.7 + r() * .6), grow: s0 * (.55 + h * .05) * (.7 + r() * .6),
        life: 1500, alpha: h < 45 ? .55 : .3, seed: r(), kind: 0,
      });
    }
  }
  // 发射烟云：燃气经导流槽沿甲板/海面扩散，海水蒸汽翻滚
  const site = toThree(S.main.pointAt(0)), up = site.clone().normalize();
  const e = new THREE.Vector3(0, 1, 0).cross(up).normalize(), nn = up.clone().cross(e);
  for (let i = 0; i < 900; i++) {
    const t = Math.pow(r(), 1.6) * 9;
    const ang = (r() < .7 ? Math.PI / 2 + (r() - .5) * 1.3 : r() * Math.PI * 2);   // 主要沿导流槽方向喷出
    const dir = e.clone().multiplyScalar(Math.cos(ang)).add(nn.clone().multiplyScalar(Math.sin(ang)));
    const spd = (.012 + r() * .03) * (1 - t / 14);
    const p0 = site.clone().addScaledVector(up, -.004 + r() * .004).addScaledVector(dir, .004 + r() * .01);
    out.push({
      p: p0.sub(anchor).toArray(), t, v: dir.multiplyScalar(spd).addScaledVector(up, .002 + r() * .006).toArray(),
      s0: .006 + r() * .01, grow: .012 + r() * .012, life: 260, alpha: .5, seed: r(), kind: .6,
    });
  }
  return out;
}

/** 拦截弹烟迹 */
export function interceptorSmoke(itc, anchor) {
  const r = rng(99), out = [], pos = new THREE.Vector3(), ax = new THREE.Vector3();
  let last = null;
  for (let t = itc.t0 + .02; t < itc.t1; t += .005) {
    if (itc.get('thrust', t) < .5) { last = null; continue; }
    toThree(itc.position(t, P), pos); toThree(itc.axis(t, A), ax);
    const h = pos.length() - RE;
    if (h > 45) break;
    pos.addScaledVector(ax, -.0004);
    const s0 = .0014 + .0004 * h;
    if (last && pos.distanceTo(last) < s0 * .35) continue;
    last = pos.clone();
    out.push({ p: pos.clone().sub(anchor).toArray(), t, v: wind(pos, h, r).toArray(), s0, grow: s0 * (.6 + h * .06), life: 900, alpha: .5, seed: r(), kind: 0 });
  }
  // 垂发燃气
  const site = toThree(itc.pointAt(0)), up = site.clone().normalize();
  for (let i = 0; i < 120; i++) {
    const t = itc.t0 + r() * 2.2;
    out.push({ p: site.clone().addScaledVector(up, -.006).sub(anchor).toArray(), t, v: new THREE.Vector3(r() - .5, r() * .3, r() - .5).normalize().multiplyScalar(.008 + r() * .01).toArray(), s0: .004, grow: .008, life: 160, alpha: .45, seed: r(), kind: .6 });
  }
  return out;
}

/** 再入电离尾迹（截至交会） */
export function reentryGlow(rv, tStart, tEnd, anchor) {
  const r = rng(5), out = [], pos = new THREE.Vector3();
  let last = null;
  for (let t = tStart; t < tEnd; t += .002) {
    const heat = rv.get('heat', t);
    if (heat < .08) continue;
    toThree(rv.position(t, P), pos);
    if (last && pos.distanceTo(last) < .006) continue;
    last = pos.clone();
    out.push({ p: pos.clone().sub(anchor).toArray(), t, v: [0, 0, 0], s0: .003 + .004 * Math.min(1, heat / 10), grow: .02, life: 3.5 + r() * 2, alpha: .9, seed: r(), kind: 2, heat: Math.min(1, heat / 12) });
  }
  return out;
}

/** 交会火花与燃烧碎片 */
export function interceptDebris(S, anchor) {
  const r = rng(77), out = [], pos = new THREE.Vector3();
  const { tI, PI, debris } = S.defense;
  const c = toThree(PI);
  const vRV = toThree(S.rv.velocity(tI));
  for (let i = 0; i < 1400; i++) {
    const d = new THREE.Vector3(r() - .5, r() - .5, r() - .5).normalize();
    const v = vRV.clone().multiplyScalar(.55 + r() * .4).addScaledVector(d, .3 + r() * 1.6);
    out.push({ p: c.clone().sub(anchor).toArray(), t: tI + r() * .05, v: v.toArray(), s0: .0015 + r() * .004, grow: .002, life: .6 + r() * 3.5, alpha: 1, seed: r(), kind: 2, heat: .7 + r() * .3 });
  }
  for (const d of debris) {
    let last = null;
    for (let t = d.t0; t < Math.min(d.t1, d.t0 + 40); t += .02) {
      toThree(d.position(t, P), pos);
      if (last && pos.distanceTo(last) < .03) continue;
      last = pos.clone();
      const heat = Math.max(0, 1 - (t - d.t0) / 30);
      out.push({ p: pos.clone().sub(anchor).toArray(), t, v: [0, 0, 0], s0: .002, grow: .012, life: 5 + r() * 4, alpha: .7, seed: r(), kind: 2, heat: heat * .8 });
    }
  }
  return out;
}
