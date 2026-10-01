// 离线检查仿真结果：node scripts/tune.mjs [azimuth pitchKick upperPitchEnd]
import { runFlight, SCENARIO } from '../src/sim/flight.js';

const [az, kick, pe] = process.argv.slice(2).map(Number);
const sc = { ...SCENARIO, ...(az ? { azimuth: az } : {}), ...(kick ? { pitchKick: kick } : {}), ...(pe ? { upperPitchEnd: pe } : {}) };
const t0 = performance.now();
const f = runFlight(sc);
const s = f.stats;
console.log(`sim ${(performance.now() - t0).toFixed(0)} ms, main ${f.main.t.length} rv ${f.rv.t.length} samples`);
console.log(`liftoff mass ${(s.m0 / 1000).toFixed(1)} t, maxQ ${(s.maxQ.q / 1000).toFixed(1)} kPa @T+${s.maxQ.t?.toFixed(1)} h=${s.maxQ.h?.toFixed(1)} M=${s.maxQ.mach?.toFixed(2)}, maxG ${s.maxG.g.toFixed(1)} @${s.maxG.t?.toFixed(0)}`);
console.log(`burnout T+${s.burnout.t.toFixed(0)} v=${s.burnout.speed.toFixed(3)} h=${s.burnout.h.toFixed(0)} gamma=${s.burnout.gamma.toFixed(1)}`);
console.log(`apogee ${s.apogee.h.toFixed(0)} km @T+${s.apogee.t.toFixed(0)}; reentry ${JSON.stringify(s.reentry)}`);
console.log(`peak heat ${s.peakHeat.heat.toFixed(1)} MW/m2 @h=${s.peakHeat.h.toFixed(1)}, peak g ${s.peakG.g.toFixed(0)} @h=${s.peakG.h.toFixed(1)}`);
console.log(`impact lat ${s.impact.lat.toFixed(2)} lon ${s.impact.lon.toFixed(2)} T+${s.impact.t.toFixed(0)} (${(s.impact.t / 60).toFixed(1)} min) range ${s.impact.range.toFixed(0)} km`);
for (const e of f.events.sort((a, b) => a.t - b.t)) console.log(`  T+${e.t.toFixed(1).padStart(7)}  ${e.label}  ${e.detail}`);
for (const sp of f.spent) {
  const i = sp.t.length - 1;
  const p = sp.pointAt(i), r = Math.hypot(...p);
  console.log(`  ${sp.name} ${sp.key}: ends T+${sp.t1.toFixed(0)} ${sp.endReason} lat ${(Math.asin(p[2] / r) * 57.3).toFixed(1)} lon ${(Math.atan2(p[1], p[0]) * 57.3).toFixed(1)}`);
}
console.log(`pbv ends T+${f.pbv.t1.toFixed(0)} ${f.pbv.endReason}`);
