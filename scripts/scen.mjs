import { buildScenario } from '../src/sim/scenario.js';
const t=performance.now(); const s = buildScenario(); console.log('build ms', (performance.now()-t).toFixed(0));
for (const e of s.events) console.log(`T+${e.t.toFixed(1).padStart(7)} ${e.side==='def'?'[防]':'    '} ${e.label} ${e.detail}`);
console.log(s.phases.map(p=>`${p.name} ${p.start.toFixed(0)}-${p.end.toFixed(0)}`).join(' | '));
console.log('impact', s.impactGeo, 'debris ends', s.defense.debris.map(d=>d.t1.toFixed(0)).join(','));
