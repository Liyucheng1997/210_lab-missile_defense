// 界面：阶段列表、事件日志、时间轴刻度、遥测、剖面图、防御链路
import { RE } from './sim/environment.js';

const $ = s => document.querySelector(s);
export const fmtT = t => {
  const s = Math.abs(t), m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `T${t < 0 ? '−' : '+'} ${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};
const ang = (a, b) => { const ra = Math.hypot(...a), rb = Math.hypot(...b); return Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (ra * rb)))); };

export class UI {
  constructor(S, handlers) {
    this.S = S; this.h = handlers;
    const span = S.t1 - S.t0;
    this.tToX = t => (t - S.t0) / span;
    // 阶段
    $('#phaseList').innerHTML = S.phases.map((p, i) => `<div class="phase-item" data-phase="${i}"><span class="num">0${i + 1}</span><b>${p.name}</b><small class="t">${fmtT(p.start).replace('T', '')}</small></div>`).join('');
    document.querySelectorAll('.phase-item').forEach((el, i) => el.addEventListener('click', () => handlers.seek(S.phases[i].start + .01)));
    // 事件
    $('#eventLog').innerHTML = S.events.map((e, i) => `<div class="${e.side || 'off'}" data-ev="${i}"><b>${fmtT(e.t).replace('T', '')}</b><span>${e.label}</span>${e.detail ? `<em>${e.detail}</em>` : ''}</div>`).join('');
    document.querySelectorAll('[data-ev]').forEach(el => el.addEventListener('click', () => handlers.seek(S.events[+el.dataset.ev].t - 2)));
    this.evEls = [...document.querySelectorAll('[data-ev]')];
    // 时间轴刻度
    const big = new Set(['liftoff', 'sep1', 'sep2', 'sep3', 'release', 'apogee', 'launchInt', 'intercept']);
    $('#eventTicks').innerHTML = S.events.map(e => `<i class="${e.side === 'def' ? 'def' : ''} ${big.has(e.key) ? 'big' : ''}" style="left:${this.tToX(e.t) * 100}%" title="${e.label}"></i>`).join('');
    const labs = [['点火', 0], ['助推结束', S.stats.tBo[2]], ['顶点', S.stats.apogee.t], ['截获', S.defense.tAcq], ['交会', S.defense.tI]];
    $('#timelineLabels').innerHTML = labs.map(([n, t]) => `<span style="left:${this.tToX(t) * 100}%">${n}</span>`).join('');
    // 防御链路
    const d = S.defense;
    this.chain = [['天基预警', S.sat.tDetect, S.stats.tBo[2] + 6], ['雷达截获', d.tAcq, d.tTrack], ['跟踪决策', d.tTrack, d.tL], ['拦截交战', d.tL, d.tI]];
    $('#defenseChain').innerHTML = this.chain.map(([n, a]) => `<div class="chain-item"><i></i><b>${n}</b><small>${fmtT(a).replace('T', '')}</small></div>`).join('');
    this.chainEls = [...document.querySelectorAll('.chain-item')];
    this.buildProfile();
    this.lastEv = -1;
    this.cache = {};
  }

  set(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; $(id).textContent = v; } }

  /** 当前叙事主体的遥测量 */
  telemetry(t) {
    const S = this.S, { main, rv, stats } = S, d = S.defense;
    const tc = Math.max(0, t);
    let src, name, mass, g, heat = 0;
    if (tc < stats.tRelease) { src = main; name = '主飞行体'; mass = main.get('mass', tc); g = main.get('g', tc); }
    else { src = rv; name = t < d.tI ? '再入体' : '再入体（已摧毁）'; mass = .36e3; g = rv.get('g', Math.min(tc, d.tI)); heat = rv.get('heat', Math.min(tc, d.tI)); }
    const tt = Math.min(tc, t >= stats.tRelease ? d.tI : tc);
    const p = src.position(tt), v = src.velocity(tt);
    const r = Math.hypot(...p), vr = Math.hypot(...v);
    const gamma = vr > .01 ? Math.asin((p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / (r * vr)) * 180 / Math.PI : 90;
    return {
      name, h: src.get('h', tt), speed: src.get('speed', tt), mach: src.get('mach', tt), q: src.get('q', tt) / 1000,
      g, mass: mass / 1000, range: ang(S.site, p) * RE, gamma: tc < 6 ? 90 : gamma, heat,
    };
  }

  update(t, speed, extra) {
    const S = this.S, d = S.defense;
    this.set('#simClock', fmtT(t));
    const pi = Math.max(0, S.phases.findIndex(p => t >= p.start && t < p.end));
    const idx = t >= S.t1 - .01 ? S.phases.length - 1 : pi;
    if (this.cache.phase !== idx) {
      this.cache.phase = idx;
      document.querySelectorAll('.phase-item').forEach((el, i) => { el.classList.toggle('active', i === idx); el.classList.toggle('done', i < idx); });
      $('#phaseChip').textContent = S.phases[idx].name;
    }
    const tm = this.telemetry(t);
    this.set('#telemSrc', `TELEMETRY · ${tm.name}`);
    this.set('#mAlt', tm.h.toFixed(tm.h < 100 ? 2 : 0));
    this.set('#mVel', tm.speed.toFixed(3));
    this.set('#mMach', tm.mach > 40 || tm.h > 120 ? '—' : tm.mach.toFixed(2));
    this.set('#mQ', tm.q.toFixed(tm.q < 10 ? 2 : 1));
    this.set('#mG', tm.g.toFixed(2));
    this.set('#mMass', tm.mass.toFixed(tm.mass < 1 ? 3 : 2));
    this.set('#mRange', tm.range.toFixed(0));
    this.set('#mGamma', tm.gamma.toFixed(1));
    this.set('#mHeat', tm.heat.toFixed(tm.heat < 10 ? 2 : 1));
    $('#heatBar').style.width = `${Math.min(100, tm.heat / 40 * 100)}%`;
    this.set('#speedNow', `${speed < 1 ? speed.toFixed(2) : Math.round(speed)}×`);
    // HUD（跟踪对象）
    if (extra.hud) {
      this.set('#hudObj', extra.hud.name);
      this.set('#hudAlt', extra.hud.h.toFixed(extra.hud.h < 10 ? 3 : 1));
      this.set('#hudVel', extra.hud.v.toFixed(3));
      this.set('#hudMach', extra.hud.mach == null ? '—' : extra.hud.mach.toFixed(2));
    }
    // 事件日志
    let cur = -1;
    S.events.forEach((e, i) => { if (e.t <= t) cur = i; });
    if (cur !== this.lastEv) {
      this.evEls.forEach((el, i) => { el.classList.toggle('past', i <= cur); el.classList.toggle('now', i === cur); });
      if (cur >= 0) this.evEls[cur].scrollIntoView({ block: 'nearest' });
      if (cur > this.lastEv && cur >= 0 && extra.playing && t - S.events[cur].t < 3) this.h.toast(S.events[cur]);
      this.lastEv = cur;
    }
    // 防御链路
    this.chain.forEach(([, a, b], i) => { this.chainEls[i].classList.toggle('active', t >= a && t < b); this.chainEls[i].classList.toggle('done', t >= b); });
    const rs = extra.radar;
    this.set('#rRange', rs ? `${rs.r.toFixed(0)} km` : '视距外');
    this.set('#rEl', rs ? `${rs.el.toFixed(1)}°` : '—');
    this.set('#rTti', t < d.tI && t > d.tAcq ? `${(d.tI - t).toFixed(1)} s` : t >= d.tI ? '已交会' : '—');
    this.drawProfile(t);
  }

  buildProfile() {
    const S = this.S, pts = [], add = (tr, t0, t1, dt) => { for (let t = t0; t <= t1; t += dt) { const p = tr.position(t); pts.push({ t, x: ang(S.site, p) * RE, y: Math.hypot(...p) - RE }); } };
    add(S.main, 0, S.stats.tRelease, 1);
    add(S.rv, S.stats.tRelease, S.rv.t1, 2);
    this.prof = pts;
    this.profInt = []; const itc = S.defense.interceptor;
    for (let t = itc.t0; t <= itc.t1; t += .5) { const p = itc.position(t); this.profInt.push({ t, x: ang(S.site, p) * RE, y: Math.hypot(...p) - RE }); }
    this.pxMax = Math.ceil(S.stats.impact.range / 1000) * 1000;
    this.pyMax = Math.ceil(S.stats.apogee.h / 200) * 200 + 100;
  }

  drawProfile(t) {
    const c = $('#profile'), ctx = c.getContext('2d'), W = c.width, H = c.height;
    const L = 52, R = 14, T = 14, B = 34;
    const X = x => L + x / this.pxMax * (W - L - R), Y = y => H - B - y / this.pyMax * (H - T - B);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '17px "IBM Plex Mono", monospace'; ctx.fillStyle = '#6f8b9b'; ctx.strokeStyle = 'rgba(149,205,232,.12)'; ctx.lineWidth = 1;
    for (let y = 0; y <= this.pyMax; y += 400) { ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(W - R, Y(y)); ctx.stroke(); ctx.fillText(String(y), 4, Y(y) + 5); }
    for (let x = 0; x <= this.pxMax; x += 2000) { ctx.beginPath(); ctx.moveTo(X(x), T); ctx.lineTo(X(x), H - B); ctx.stroke(); ctx.fillText(String(x / 1000) + 'k', X(x) - 12, H - 10); }
    ctx.fillStyle = '#4f6a7a'; ctx.fillText('km', W - 40, H - 10);
    // 大气层（100 km）
    ctx.fillStyle = 'rgba(80,160,230,.10)'; ctx.fillRect(L, Y(100), W - L - R, Y(0) - Y(100));
    const d = this.S.defense;
    const path = (arr, until, style, width, dash = []) => {
      ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = style; ctx.lineWidth = width;
      let first = true;
      for (const p of arr) { if (p.t > until) break; first ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y)); first = false; }
      ctx.stroke(); ctx.setLineDash([]);
    };
    path(this.prof, 1e9, 'rgba(255,192,106,.35)', 2, [6, 6]);
    path(this.prof, Math.min(t, d.tI), '#ff806b', 3);
    path(this.profInt, Math.min(t, d.tI), '#6ee8f3', 3);
    // 当前点
    const cur = [...this.prof].reverse().find(p => p.t <= Math.min(Math.max(t, 0), d.tI));
    if (cur) { ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff806b'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(X(cur.x), Y(cur.y), 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
    if (t >= d.tI) { const p = this.prof.find(q => q.t >= d.tI); ctx.strokeStyle = '#ffc06a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 9, 0, 7); ctx.stroke(); }
  }
}
