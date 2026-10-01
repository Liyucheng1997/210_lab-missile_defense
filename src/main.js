import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import { buildScenario } from './sim/scenario.js';
import { RE, OMEGA, P0, atmosphere } from './sim/environment.js';
import { createEarth, createOceanPatch } from './scene/earth.js';
import { buildLaunchVehicle, buildInterceptor, buildLaunchPlatform, buildShip, buildSatellite } from './scene/models.js';
import { Plume, ParticleSystem, glowSprite, makeLine, DynamicLine, radarFan, surfaceRing, plumeLayer } from './scene/effects.js';
import { toThree, exhaustSmoke, interceptorSmoke, reentryGlow, interceptDebris } from './scene/particles.js';
import { LOGDEPTH_VERT_PARS, LOGDEPTH_VERT, LOGDEPTH_FRAG_PARS, LOGDEPTH_FRAG } from './scene/glsl.js';
import { UI } from './ui.js';

const $ = s => document.querySelector(s);
const KM = .001;                                 // 模型米 → km
const v3 = () => new THREE.Vector3();
const P = [0, 0, 0], A = [0, 0, 0];

setTimeout(init, 30);

function init() {
  const S = buildScenario();
  const D = S.defense, ST = S.stats;
  const tShroud = S.events.find(e => e.key === 'shroud').t;

  // ---------------------------------------------------------------------------
  // 渲染器与后期
  // ---------------------------------------------------------------------------
  const canvas = $('#globe');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const camera = new THREE.PerspectiveCamera(42, 1, .0004, 5e7);
  camera.position.set(.06, .012, .05);

  const bgScene = new THREE.Scene(), fgScene = new THREE.Scene();
  bgScene.background = new THREE.Color(0x000000);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(bgScene, camera));
  const fgPass = new RenderPass(fgScene, camera); fgPass.clear = false; fgPass.clearDepth = false;
  composer.addPass(fgPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .55, .55, .92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .08; controls.enablePan = false; controls.zoomSpeed = 1.2; controls.rotateSpeed = .6;
  let lastUser = -1e9;
  controls.addEventListener('start', () => { lastUser = performance.now(); });
  controls.addEventListener('change', () => { if (performance.now() - lastUser < 200) lastUser = performance.now(); });
  canvas.addEventListener('wheel', () => { lastUser = performance.now(); }, { passive: true });

  // 两个场景共享同一套“浮动原点 + 地固系”变换
  const bgRoot = new THREE.Group(), fgRoot = new THREE.Group();
  const bgEarth = new THREE.Group(), fgEarth = new THREE.Group();
  bgScene.add(bgRoot); bgRoot.add(bgEarth); fgScene.add(fgRoot); fgRoot.add(fgEarth);

  // ---------------------------------------------------------------------------
  // 地球、海面、星空、太阳
  // ---------------------------------------------------------------------------
  const loader = new THREE.TextureLoader();
  const earth = createEarth(loader);
  bgEarth.add(earth.group);
  const U = earth.uniforms;
  const simUniforms = { uSimTime: { value: 0 }, uSun: U.uSun };
  const site = toThree(S.main.pointAt(0)), siteUp = site.clone().normalize();
  const siteSea = siteUp.clone().multiplyScalar(RE);
  const ship = toThree(D.ship), shipUp = ship.clone().normalize();
  earth.cloudUniforms.uClear.value[0].copy(siteSea); earth.cloudUniforms.uClear.value[1].copy(ship);
  const oceanA = createOceanPatch(siteSea, U), oceanB = createOceanPatch(ship, U);
  bgEarth.add(oceanA, oceanB);

  const sky = new THREE.Group(); bgScene.add(sky);
  const stars = makeStars(); sky.add(stars);
  const sunSprite = glowSprite(new THREE.Color(1, .95, .85), { size: 260, worldSize: false, intensity: 40, core: .035 });
  sunSprite.renderOrder = -19; sky.add(sunSprite);

  // ---------------------------------------------------------------------------
  // 光照
  // ---------------------------------------------------------------------------
  const sunLight = new THREE.DirectionalLight(0xffffff, 3); fgScene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x0c2a44, .4); fgScene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  fgScene.environment = pmrem.fromScene(envScene(), .04).texture;

  // ---------------------------------------------------------------------------
  // 模型
  // ---------------------------------------------------------------------------
  const frameAt = (pos, fwdHint) => {
    const up = pos.clone().normalize();
    const f = fwdHint.clone().addScaledVector(up, -fwdHint.dot(up)).normalize();
    const east = f.clone().cross(up).normalize();     // x = f × up（右）
    return new THREE.Matrix4().makeBasis(east, up, f.clone().negate());
  };
  const placeOnSurface = (obj, pos, fwd) => { obj.position.copy(pos); obj.quaternion.setFromRotationMatrix(frameAt(pos, fwd)); };
  const headThree = (() => {
    const p1 = toThree(S.main.position(25));
    return p1.sub(site).addScaledVector(siteUp, -p1.clone().sub(site).dot(siteUp)).normalize();
  })();

  const platform = buildLaunchPlatform(); platform.scale.setScalar(KM);
  const platWrap = new THREE.Group(); platWrap.add(platform); placeOnSurface(platWrap, siteSea, headThree.clone().applyAxisAngle(siteUp, Math.PI / 2));
  fgEarth.add(platWrap);

  const shipModel = buildShip(); shipModel.scale.setScalar(KM);
  const shipWrap = new THREE.Group(); shipWrap.add(shipModel);
  const PIg = toThree(D.PI).normalize().multiplyScalar(RE);
  // 船首朝向交会点地面投影（模型 +X 为船首 → 让 frame 的 -Z 前向对应 +X：绕 up 旋转）
  placeOnSurface(shipWrap, ship, PIg.clone().sub(ship)); shipModel.rotation.y = Math.PI / 2;
  fgEarth.add(shipWrap);

  const satModel = buildSatellite(); satModel.scale.setScalar(KM);
  const satWrap = new THREE.Group(); satWrap.add(satModel);
  const satPos = toThree(S.sat.p); placeOnSurface(satWrap, satPos, new THREE.Vector3(0, 1, 0));
  fgEarth.add(satWrap);

  // 运载器
  const lv = buildLaunchVehicle();
  const stack = new THREE.Group(), stackScale = new THREE.Group();
  stackScale.scale.setScalar(KM); stackScale.add(lv.root); stack.add(stackScale); fgEarth.add(stack);
  const plume = new Plume(); lv.root.add(plume.group);
  const thrustMax = [0, 1, 2].map(i => { let m = 1; for (let t = ST.tIgn[i]; t < ST.tBo[i]; t += .5) m = Math.max(m, S.main.get('thrust', t)); return m; });
  const nozzleExit = [-.6, 7.55, 12.95], nozzleR = [.58, .5, .42];

  // 分离体可视化
  const spentObjs = S.spent.map(tr => {
    const key = tr.key.startsWith('shroud') ? (tr.key === 'shroud0' ? 'shroudL' : 'shroudR') : tr.key;
    const wrap = new THREE.Group(), holder = new THREE.Group(); holder.scale.setScalar(KM);
    const clone = lv.parts[key].clone(); clone.position.y = -lv.centers[key];
    holder.add(clone); wrap.add(holder); fgEarth.add(wrap); wrap.visible = false;
    const r = mulberry(tr.t0 * 1000 | 0);
    return { tr, wrap, holder, key, center: lv.centers[key], spin: new THREE.Vector3(r() - .5, (r() - .5) * .3, r() - .5).normalize(), rate: (key.startsWith('shroud') ? .9 : .12 + r() * .25) * (r() > .5 ? 1 : -1), side: key === 'shroudL' ? 1 : -1 };
  });
  const mkPart = (part, center) => {
    const wrap = new THREE.Group(), holder = new THREE.Group(); holder.scale.setScalar(KM);
    const c = part.clone(); c.position.y = -center; holder.add(c); wrap.add(holder); fgEarth.add(wrap); wrap.visible = false;
    return { wrap, holder, clone: c };
  };
  const pbvObj = mkPart(lv.parts.pbv, 16.6);
  const pbvPlume = new Plume(); pbvPlume.group.position.y = 16.3; lv.root.add(pbvPlume.group);
  const rvObj = mkPart(lv.parts.rv, 0); rvObj.clone.position.y = -.9;
  // 再入等离子体：鞘层 + 尾流
  const sheath = makeSheath(); sheath.position.y = -.9; rvObj.holder.add(sheath);
  const wake = plumeLayer([2.6, 1.5, .9], [1.4, .35, .25], 9); wake.position.y = -.9; rvObj.holder.add(wake);
  const wake2 = plumeLayer([1.3, .55, .9], [.5, .15, .5], 11); wake2.position.y = -.9; rvObj.holder.add(wake2);
  const rvLight = new THREE.PointLight(0xffb070, 0, .3, 2); rvObj.holder.add(rvLight);

  // 拦截弹
  const it = buildInterceptor();
  const itWrap = new THREE.Group(), itHolder = new THREE.Group(); itHolder.scale.setScalar(KM); itHolder.add(it.root); itWrap.add(itHolder); fgEarth.add(itWrap);
  const itPlume = new Plume(); it.root.add(itPlume.group);
  const kvPuffs = new THREE.Group(); it.parts.kv.add(kvPuffs);
  for (let i = 0; i < 4; i++) { const p = plumeLayer([3, 3, 3.2], [1, 1, 1.4], 20 + i); p.position.set(Math.cos(i * Math.PI / 2) * .18, 5.2, Math.sin(i * Math.PI / 2) * .18); p.rotation.z = Math.PI / 2; p.rotation.y = -i * Math.PI / 2; p.userData.i = i; kvPuffs.add(p); }
  const droppedObjs = D.dropped.map((tr, i) => {
    const part = i === 0 ? it.parts.booster : it.parts.stage2;
    const o = mkPart(part, i === 0 ? 1.5 : 4.0);
    if (i === 1) { const n = it.parts.nose.clone(); n.position.y = -4.0; o.holder.add(n); }
    return { tr, ...o, rate: .8 + i * .5 };
  });

  // 碎片
  const debrisMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.0012, 0), new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: .7, metalness: .4, emissive: 0xff5a1a, emissiveIntensity: 0 }), D.debris.length);
  debrisMesh.frustumCulled = false; fgEarth.add(debrisMesh);

  // ---------------------------------------------------------------------------
  // 粒子
  // ---------------------------------------------------------------------------
  const smokeA = new ParticleSystem(exhaustSmoke(S, site, nozzleExit.map(x => x - .3)), site, { uniforms: simUniforms });
  const smokeB = new ParticleSystem(interceptorSmoke(D.interceptor, ship), ship, { uniforms: simUniforms });
  const glowRV = new ParticleSystem(reentryGlow(S.rv, ST.reentry.t - 30, D.tI, toThree(D.PI)), toThree(D.PI), { additive: true, uniforms: simUniforms });
  const glowDebris = new ParticleSystem(interceptDebris(S, toThree(D.PI)), toThree(D.PI), { additive: true, uniforms: simUniforms });
  fgEarth.add(smokeA.mesh, smokeB.mesh, glowRV.mesh, glowDebris.mesh);
  const flash = glowSprite(new THREE.Color(1, .93, .8), { size: 1, intensity: 0, core: .12 });
  const fireball = glowSprite(new THREE.Color(1, .5, .18), { size: 1, intensity: 0, core: .35 });
  flash.position.copy(toThree(D.PI)); fireball.position.copy(toThree(D.PI));
  fgEarth.add(flash, fireball);
  const flashLight = new THREE.PointLight(0xffd0a0, 0, 40, 2); flashLight.position.copy(toThree(D.PI)); fgEarth.add(flashLight);

  // ---------------------------------------------------------------------------
  // 轨迹线 / 传感器
  // ---------------------------------------------------------------------------
  const lineMats = [];
  const L = (pts, anchor, o) => { const l = makeLine(pts, anchor, o); lineMats.push(l.material); return l; };
  const sampleTrack = (tr, t0, t1, dt, lift = 0) => { const ts = [], pts = []; for (let t = t0; t <= t1 + 1e-6; t += dt) { ts.push(t); const p = toThree(tr.position(Math.min(t, t1), P)); if (lift) p.setLength(RE + lift); pts.push(p); } return { ts, pts }; };
  const mainS = sampleTrack(S.main, 0, ST.tRelease, .5), rvS = sampleTrack(S.rv, ST.tRelease, S.rv.t1, 1);
  const trajTs = [...mainS.ts, ...rvS.ts], trajPts = [...mainS.pts, ...rvS.pts];
  const layers = { trajectory: new THREE.Group(), debris: new THREE.Group(), sensors: new THREE.Group() };
  Object.values(layers).forEach(g => fgEarth.add(g));
  const trajFull = L(trajPts, site, { color: 0xffc06a, width: 1.5, opacity: .55, dashed: true, dashSize: 60, gapSize: 40 });
  const trajDone = L(trajPts, site, { color: 0xff6b4a, width: 2.6, opacity: .95 });
  const groundPts = trajPts.map(p => p.clone().setLength(RE + .5));
  const ground = L(groundPts, site, { color: 0xd8e6ee, width: 1, opacity: .35, dashed: true, dashSize: 25, gapSize: 25 });
  layers.trajectory.add(trajFull, trajDone, ground);
  const impactP = toThree(ST.impact.p);
  for (const [r, o] of [[8, .9], [22, .5], [45, .25]]) layers.trajectory.add(surfaceRing(impactP, r, .4, { color: 0xffc06a, width: 1.4, opacity: o }));
  const spentLines = S.spent.filter(s => !s.small).map(tr => { const s = sampleTrack(tr, tr.t0, tr.t1, 2); const l = L(s.pts, s.pts[0], { color: 0x9fb2bd, width: 1.2, opacity: .55 }); layers.debris.add(l); return { tr, ts: s.ts, l }; });
  const impactMarks = S.spent.filter(s => !s.small).map(tr => { const p = toThree(tr.pointAt(tr.t.length - 1)); const ring = surfaceRing(p, 6, .3, { color: 0x9fb2bd, width: 1.2, opacity: .7 }); layers.debris.add(ring); return { tr, ring, p }; });
  const itS = sampleTrack(D.interceptor, D.interceptor.t0, D.tI, .1);
  const itLine = L(itS.pts, ship, { color: 0x6ee8f3, width: 2.4, opacity: .95 }); layers.trajectory.add(itLine);
  const PIthree = toThree(D.PI);
  const radarDir = PIthree.clone().sub(ship); // 指向威胁来向（上游）
  const upstream = toThree(S.rv.position(D.tAcq)).sub(ship);
  const fan = radarFan(toThree(D.radar), shipUp, upstream.addScaledVector(shipUp, -upstream.dot(shipUp)).normalize(), D.radarRange, { azHalf: 60, elMax: 80 });
  layers.sensors.add(fan); void radarDir;
  const beam = new DynamicLine(ship, { color: 0x6ee8f3, width: 1.6, opacity: .9, dashed: true, dashSize: 8, gapSize: 6 }); lineMats.push(beam.line.material); layers.sensors.add(beam.line);
  const los = new DynamicLine(satPos, { color: 0xc9a5ff, width: 1.4, opacity: .8, dashed: true, dashSize: 400, gapSize: 300 }); lineMats.push(los.line.material); layers.sensors.add(los.line);
  layers.sensors.add(surfaceRing(ship, 30, .3, { color: 0x6ee8f3, width: 1, opacity: .5 }));

  // 远景标记点
  const markers = makeMarkers(8); fgEarth.add(markers.points);

  // ---------------------------------------------------------------------------
  // 标注
  // ---------------------------------------------------------------------------
  const labelDefs = [
    { id: 'site', cls: 'off', title: '海上发射平台 A', sub: `${S.sc.launch.lat.toFixed(1)}°N ${S.sc.launch.lon.toFixed(1)}°E · 虚构`, pos: () => site },
    { id: 'impact', cls: 'tgt', title: '预计落区 B', sub: `开阔海域 · 航程 ${ST.impact.range.toFixed(0)} km`, pos: () => impactP },
    { id: 'ship', cls: 'def', title: '区域防御单元（舰载）', sub: '雷达 + 垂直发射拦截弹', pos: () => ship },
    { id: 'sat', cls: 'sat', title: '预警卫星', sub: 'GEO · 红外凝视', pos: () => satPos },
    { id: 'vehicle', cls: 'off', title: '主飞行体', sub: '', pos: null },
    { id: 'itc', cls: 'def', title: '拦截弹', sub: '', pos: null },
    ...S.spent.filter(s => !s.small).map(tr => ({ id: 'fall' + tr.key, cls: 'dim', title: `${tr.name.replace('残骸', '')}落区`, sub: `T+${Math.round(tr.t1)} s 落海`, pos: () => toThree(tr.pointAt(tr.t.length - 1)), layer: 'debris', after: tr.t0 })),
  ];
  const labelBox = $('#labels');
  for (const l of labelDefs) { l.el = document.createElement('div'); l.el.className = `lbl ${l.cls}`; l.el.innerHTML = `<b>${l.title}</b><small>${l.sub}</small>`; labelBox.appendChild(l.el); l.small = l.el.querySelector('small'); l.b = l.el.querySelector('b'); }

  // ---------------------------------------------------------------------------
  // 状态
  // ---------------------------------------------------------------------------
  const state = { t: S.t0, playing: false, speedMode: 'auto', speed: 1, speedNow: 1, layers: { trajectory: true, debris: true, sensors: true, labels: true, clouds: true }, cam: 'auto', chase: 'auto' };
  const ui = new UI(S, { seek, toast });
  const autoSpeed = t => t < -4 ? 2 : t < 18 ? 1 : t < 65 ? 2 : t < 186 ? 3 : t < 325 ? 10 : t < 362 ? 3 : t < D.tAcq - 60 ? 60 : t < D.tL - 8 ? 15 : t < D.tL + 10 ? 1.5 : t < D.tI - 2.5 ? 1 : t < D.tI + 1.2 ? .2 : t < D.tI + 15 ? 1 : 5;

  // ---------------------------------------------------------------------------
  // 相机：浮动原点 + 跟随局部坐标系 + 导演
  // ---------------------------------------------------------------------------
  const earthQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const toI = p => p.clone().applyQuaternion(earthQ);          // 地固 → 惯性世界
  const objState = (key, t) => {
    // 返回 {p (地固 three), fwd, name, h, v, mach, center 偏移}
    const tc = Math.max(t, 0);
    const res = (tr, off, name, tt = tc) => {
      const p = toThree(tr.position(tt, P)), ax = toThree(tr.axis(tt, A)), v = toThree(tr.velocity(tt, A));
      p.addScaledVector(ax, off * KM);
      return { p, fwd: v.lengthSq() > 1e-8 ? v : headThree.clone(), name, h: p.length() - RE, v: v.length(), mach: tr.mach ? tr.get('mach', tt) : null };
    };
    switch (key) {
      case 'stack':
        if (t < ST.tRelease) return res(S.main, t < ST.tBo[0] ? 9.5 : t < ST.tBo[1] ? 14 : 16.8, '主飞行体');
        if (t < D.tI) return res(S.rv, .9, '再入体');
        return { p: PIthree.clone(), fwd: toThree(S.rv.velocity(D.tI)), name: '交会点 · 碎片云', h: PIthree.length() - RE, v: 0, mach: null };
      case 'pbv': return t < ST.tRelease ? objState('stack', t) : res(S.pbv, 16.6, '末助推舱', Math.min(tc, S.pbv.t1));
      case 's1': case 's2': case 's3': {
        const o = spentObjs.find(s => s.key === key);
        return t < o.tr.t0 ? objState('stack', t) : res(o.tr, o.center, o.tr.name, Math.min(tc, o.tr.t1));
      }
      case 'interceptor':
        if (t < D.tL) return { p: ship.clone().addScaledVector(shipUp, .012), fwd: PIg.clone().sub(ship), name: '拦截弹（待发）', h: .012, v: 0, mach: null };
        if (t < D.tI) return res(D.interceptor, t < D.tKV ? 3 : 5.4, t < D.tKV ? '拦截弹' : '动能杀伤器');
        return objState('stack', t);
      case 'ship': return { p: ship.clone().addScaledVector(shipUp, .015), fwd: PIg.clone().sub(ship), name: '防御舰', h: 0, v: 0, mach: null };
      case 'platform': return { p: site.clone().addScaledVector(siteUp, .006), fwd: headThree.clone(), name: '海上发射平台', h: .012, v: 0, mach: null };
      case 'sat': return { p: satPos.clone(), fwd: new THREE.Vector3(1, 0, 0), name: '预警卫星', h: satPos.length() - RE, v: 3.07, mach: null };
    }
  };
  const baseDist = { stack: .07, pbv: .022, s1: .04, s2: .03, s3: .025, interceptor: .03, ship: .5, platform: .3, sat: .05 };

  function viewSpec(view, obj, t) {
    if (view === 'chase') {
      const o = objState(obj, t);
      const pI = toI(o.p), fI = toI(o.fwd);
      const m = frameAt(pI, fI.lengthSq() > 1e-10 ? fI.addScaledVector(toI(headThree), 1e-3) : toI(headThree));
      return { F: pI, Q: new THREE.Quaternion().setFromRotationMatrix(m), min: .004, max: 4000, o };
    }
    if (view === 'globe') {
      const mid = toI(toThree(S.rv.position(ST.apogee.t)));
      const m = frameAt(mid.clone().normalize(), Y.clone().addScaledVector(mid.clone().normalize(), 0));
      // 以弹道中点为“朝向相机”方向，北向上
      const back = mid.clone().normalize(), up = Y.clone().addScaledVector(back, -Y.dot(back)).normalize(), right = up.clone().cross(back);
      m.makeBasis(right, up, back);
      return { F: new THREE.Vector3(), Q: new THREE.Quaternion().setFromRotationMatrix(m), min: RE * 1.08, max: 3e5 };
    }
    if (view === 'region' || view === 'debris') {
      const g = view === 'debris' ? toI(PIthree) : toI(PIg.clone().setLength(RE + 40));
      const along = toI(toThree(S.rv.velocity(D.tI)));
      const m = frameAt(g, along.clone().cross(g.clone().normalize()));
      return { F: g, Q: new THREE.Quaternion().setFromRotationMatrix(m), min: 1, max: 3e4 };
    }
  }
  function director(t) {
    if (t < 18) return ['chase', 'stack', .09];
    if (t < 64) return ['chase', 'stack', .2];
    if (t < 188) return ['chase', 'stack', .32];
    if (t < 366) return ['chase', 'pbv', .026];
    if (t < D.tAcq - 70) return ['globe', null, 30000];
    if (t < D.tL - 5) return ['region', null, 3400];
    if (t < D.tL + 12) return ['chase', 'interceptor', .06];
    if (t < D.tI + .6) return ['chase', 'stack', .035];
    return ['debris', null, 160];
  }
  const rig = { cur: null, prev: null, k: 1, d0: 1, d1: 1, hop: 0 };
  function setView(view, obj, dist) {
    const key = view + ':' + (obj || '');
    if (rig.cur && rig.cur.key === key) return;
    rig.prev = rig.cur; rig.cur = { view, obj, key, dist };
    rig.k = rig.prev ? 0 : 1;
    rig.d0 = camera.position.length(); rig.d1 = dist;
    if (rig.prev) {
      const a = viewSpec(rig.prev.view, rig.prev.obj, state.t).F, b = viewSpec(view, obj, state.t).F;
      rig.hop = Math.max(0, Math.log(a.distanceTo(b) / Math.max(rig.d0, rig.d1, 1e-3)) * .85);
    }
    if (!rig.prev) camera.position.setLength(dist);
  }
  const smooth = x => x * x * (3 - 2 * x);
  function updateRig(dtReal, t) {
    if (state.cam === 'auto') { const [v, o, d] = director(t); setView(v, o, d); }
    const cur = viewSpec(rig.cur.view, rig.cur.obj, t);
    let F = cur.F, Q = cur.Q;
    if (rig.k < 1) {
      rig.k = Math.min(1, rig.k + dtReal / 2.6);
      const e = smooth(rig.k), prev = viewSpec(rig.prev.view, rig.prev.obj, t);
      const ld = Math.log(rig.d0) + (Math.log(rig.d1) - Math.log(rig.d0)) * e + rig.hop * Math.sin(Math.PI * e);
      const d = Math.exp(ld);
      const w = rig.hop > 0 ? e : Math.abs(rig.d1 - rig.d0) > 1e-9 ? THREE.MathUtils.clamp((d - rig.d0) / (rig.d1 - rig.d0), 0, 1) : e;
      F = prev.F.clone().lerp(cur.F, w); Q = prev.Q.clone().slerp(cur.Q, e);
      camera.position.setLength(d);
      controls.minDistance = 0; controls.maxDistance = Infinity;
    } else {
      controls.minDistance = cur.min; controls.maxDistance = cur.max;
      // 导演模式下用户未操作时，距离缓动到推荐值
      if (state.cam === 'auto' && performance.now() - lastUser > 5000) {
        const d = camera.position.length(), target = rig.cur.dist;
        camera.position.setLength(Math.exp(Math.log(d) + (Math.log(target) - Math.log(d)) * Math.min(1, dtReal * .6)));
      }
    }
    const inv = Q.clone().invert();
    for (const root of [fgRoot, bgRoot]) { root.quaternion.copy(inv); root.position.copy(F).applyQuaternion(inv).negate(); }
    return cur;
  }

  // ---------------------------------------------------------------------------
  // 每帧更新
  // ---------------------------------------------------------------------------
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
  function orientAxis(obj, axisThree, posThree) {
    const up = posThree.clone().normalize();
    let x = axisThree.clone().cross(up);
    if (x.lengthSq() < .0025) x = headThree.clone().cross(axisThree);
    x.normalize();
    const z = x.clone().cross(axisThree).normalize();
    obj.quaternion.setFromRotationMatrix(tmpM.makeBasis(x, axisThree, z));
  }
  const prRatio = h => Math.min(1, atmosphere(h).p / P0);

  function updateWorld(t, wall) {
    const tc = Math.max(0, t);
    earthQ.setFromAxisAngle(Y, OMEGA * t);
    fgEarth.quaternion.copy(earthQ); bgEarth.quaternion.copy(earthQ);
    simUniforms.uSimTime.value = t;
    U.uTime.value = wall;

    // --- 主飞行体 ---
    const preRelease = t < ST.tRelease;
    stack.visible = preRelease;
    if (preRelease) {
      const p = toThree(S.main.position(tc, P)), ax = toThree(S.main.axis(tc, A)).normalize();
      stack.position.copy(p); orientAxis(stack, ax, p);
      lv.parts.s1.visible = t < ST.tBo[0]; lv.parts.s2.visible = t < ST.tBo[1]; lv.parts.s3.visible = t < ST.tBo[2];
      lv.parts.shroudL.visible = lv.parts.shroudR.visible = t < tShroud;
      const thrust = t >= 0 ? S.main.get('thrust', tc) : 0, stg = t < ST.tBo[0] ? 0 : t < ST.tBo[1] ? 1 : 2;
      const h = p.length() - RE, pr = prRatio(h);
      const mainBurn = t >= 0 && t < ST.tBo[2] + .5 && thrust > 2000 && !(t > ST.tBo[stg] - .02 && t < ST.tIgn[Math.min(2, stg + 1)]);
      plume.group.position.y = nozzleExit[stg];
      plume.update(pr, mainBurn ? Math.min(1, thrust / thrustMax[stg]) : 0, nozzleR[stg], wall);
      lv.nozzleInner.emissiveIntensity = mainBurn ? 3 : 0;
      const pbvBurn = !mainBurn && thrust > 100;
      pbvPlume.update(0, pbvBurn ? .6 : 0, .05, wall, 'small');
    }
    // --- 分离体 ---
    for (const o of spentObjs) {
      const vis = t >= o.tr.t0 && t < o.tr.t1;
      o.wrap.visible = vis;
      if (!vis) continue;
      const age = t - o.tr.t0;
      const p = toThree(o.tr.position(t, P));
      const ax0 = toThree(o.tr.axis(o.tr.t0, A)).normalize();
      // 以分离瞬间的姿态为基准，叠加翻滚
      orientAxis(o.wrap, ax0, toThree(o.tr.pointAt(0)));
      p.addScaledVector(ax0, o.center * KM);
      o.wrap.position.copy(p);
      if (o.key.startsWith('shroud')) {
        o.holder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), o.side * Math.min(1.35, age * age * 1.4 + age * .3));
        o.holder.quaternion.multiply(tmpQ.setFromAxisAngle(o.spin, age * o.rate * .4));
      } else o.holder.quaternion.setFromAxisAngle(o.spin, age * o.rate);
    }
    // --- 末助推舱 / 再入体 ---
    pbvObj.wrap.visible = !preRelease && t < S.pbv.t1;
    if (pbvObj.wrap.visible) {
      const p = toThree(S.pbv.position(t, P)), ax = toThree(S.main.axis(ST.tRelease - .01, A)).normalize();
      orientAxis(pbvObj.wrap, ax, p); pbvObj.wrap.position.copy(p.addScaledVector(ax, 16.6 * KM));
      pbvObj.holder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.min(1, (t - ST.tRelease) * .02) * .6);
    }
    const rvVis = !preRelease && t < D.tI;
    rvObj.wrap.visible = rvVis;
    let heat = 0;
    if (rvVis) {
      const p = toThree(S.rv.position(t, P)), ax = toThree(S.rv.axis(t, A)).normalize();
      orientAxis(rvObj.wrap, ax, p); rvObj.wrap.position.copy(p.addScaledVector(ax, 18.0 * KM));
      rvObj.holder.quaternion.setFromAxisAngle(Y, (t - ST.tRelease) * 2.1);   // 自旋稳定
      heat = S.rv.get('heat', t);
    }
    const hk = Math.min(1, heat / 18);
    sheath.visible = wake.visible = wake2.visible = heat > .02;
    sheath.material.uniforms.uI.value = hk * 3.2 + Math.min(1, heat * 2) * .3;
    sheath.material.uniforms.uTime.value = wall;
    for (const [w, L0, R1, I] of [[wake, 4 + 70 * hk, .9 + 5 * hk, 1.8], [wake2, 12 + 220 * hk, 1.5 + 14 * hk, .5]]) {
      const u = w.material.uniforms; u.uLen.value = L0; u.uR0.value = .27; u.uR1.value = R1; u.uShape.value = .6; u.uIntensity.value = I * Math.min(1, heat * .8 + hk); u.uFalloff.value = 2.6; u.uEdge.value = 1.4; u.uTime.value = wall;
    }
    rvLight.intensity = .0006 * hk;

    // --- 拦截弹 ---
    const itVis = t >= D.tL - 30 && t < D.tI;
    itWrap.visible = itVis;
    if (itVis) {
      const tt = Math.max(t, D.tL);
      const p = toThree(D.interceptor.position(tt, P)), ax = toThree(D.interceptor.axis(tt, A)).normalize();
      if (t < D.tL) { p.copy(ship).addScaledVector(shipUp, .0085); ax.copy(shipUp); }
      orientAxis(itWrap, ax, p); itWrap.position.copy(p);
      it.parts.booster.visible = t < D.tL + 4.8; it.parts.stage2.visible = it.parts.nose.visible = t < D.tKV;
      const burn = t >= D.tL && D.interceptor.get('thrust', tt) > .5;
      const st = t < D.tL + 4.8 ? 0 : 1;
      itPlume.group.position.y = st === 0 ? -.28 : 3.08;
      itPlume.update(prRatio(p.length() - RE), burn ? 1 : 0, st === 0 ? .17 : .12, wall);
      kvPuffs.visible = t > D.tKV && t < D.tI;
      kvPuffs.children.forEach(c => { const on = Math.sin(wall * 9 + c.userData.i * 2.3) > .55; const u = c.material.uniforms; c.visible = on; u.uLen.value = .7; u.uR0.value = .02; u.uR1.value = .12; u.uShape.value = .6; u.uIntensity.value = 1.2; u.uFalloff.value = 3; u.uEdge.value = 1.2; u.uTime.value = wall; });
    }
    for (const o of droppedObjs) {
      const vis = t >= o.tr.t0 && t < Math.min(o.tr.t1, o.tr.t0 + 400);
      o.wrap.visible = vis; if (!vis) continue;
      const p = toThree(o.tr.position(t, P)), ax0 = toThree(o.tr.axis(o.tr.t0, A)).normalize();
      orientAxis(o.wrap, ax0, p); o.wrap.position.copy(p);
      o.holder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, .3).normalize(), (t - o.tr.t0) * o.rate);
    }
    // --- 碎片 ---
    debrisMesh.visible = t >= D.tI;
    if (debrisMesh.visible) {
      D.debris.forEach((d, i) => {
        const tt = Math.min(t, d.t1), p = toThree(d.position(tt, P));
        tmpQ.setFromAxisAngle(new THREE.Vector3(Math.sin(i), 1, Math.cos(i * 3)).normalize(), (t - D.tI) * (3 + i % 5));
        tmpM.compose(p, tmpQ, new THREE.Vector3(1, 1, 1).multiplyScalar(.6 + (i % 7) * .4));
        debrisMesh.setMatrixAt(i, tmpM);
      });
      debrisMesh.instanceMatrix.needsUpdate = true;
      debrisMesh.material.emissiveIntensity = 4 * Math.max(0, 1 - (t - D.tI) / 25);
    }
    // --- 交会闪光 ---
    const ft = t - D.tI;
    const fOn = ft >= 0 && ft < 12;
    flash.visible = fireball.visible = fOn;
    if (fOn) {
      flash.material.uniforms.uSize.value = .25 + 2.2 * Math.min(1, ft / .25);
      flash.material.uniforms.uIntensity.value = 60 * Math.exp(-ft * 4);
      fireball.material.uniforms.uSize.value = .1 + 1.3 * Math.sqrt(Math.min(ft, 6));
      fireball.material.uniforms.uIntensity.value = 5 * Math.exp(-ft * .7);
    }
    flashLight.intensity = fOn ? 300 * Math.exp(-ft * 3) : 0;
    oceanB.material.uniforms.uFlash.value.set(...toThree(D.PI).sub(ship).toArray(), 0);

    // --- 线与传感器 ---
    const idx = Math.max(0, binIdx(trajTs, Math.min(Math.max(t, 0), D.tI)));
    trajDone.geometry.instanceCount = idx;
    trajDone.visible = t > 0;
    for (const s of spentLines) { s.l.visible = t > s.tr.t0; s.l.geometry.instanceCount = Math.max(0, binIdx(s.ts, t)); }
    for (const m of impactMarks) m.ring.visible = t > m.tr.t0;
    itLine.visible = t > D.tL; itLine.geometry.instanceCount = Math.max(0, Math.min(itS.ts.length - 1, Math.round((t - D.tL) / .1)));
    fan.material.uniforms.uTime.value = wall; fan.material.uniforms.uOpacity.value = t > D.tAcq - 120 ? 1 : .45;
    const tracking = t >= D.tAcq && t < D.tI;
    beam.line.visible = tracking;
    if (tracking) beam.set(toThree(D.radar), toThree(S.rv.position(t, P)));
    const ir = t >= S.sat.tDetect && t < ST.tBo[2] + 6;
    los.line.visible = ir;
    if (ir) los.set(satPos, toThree(S.main.position(t, P)));
  }

  function binIdx(arr, t) { let lo = 0, hi = arr.length - 1; if (t <= arr[0]) return 0; if (t >= arr[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m; else hi = m; } return lo; }

  // 光照：太阳可见性（地影）、大气红化、天空光
  const sunI = toThree(S.sunDir).normalize();
  function updateLighting(focusLocal, camLocal) {
    const sunLocal = sunI.clone().applyQuaternion(earthQ.clone().invert());
    U.uSun.value.copy(sunLocal);
    U.uCam.value.copy(camLocal);
    const sunWorld = sunI.clone().applyQuaternion(fgRoot.quaternion);
    sunLight.position.copy(sunWorld); sunLight.target.position.set(0, 0, 0);
    // 太阳精灵位于相机方向远处
    sky.position.copy(camera.position); sky.quaternion.copy(fgRoot.quaternion);
    sunSprite.position.copy(sunI).multiplyScalar(4e6);
    // 焦点处地影
    const p = focusLocal, d = p.dot(sunLocal), perp = p.clone().addScaledVector(sunLocal, -d).length();
    const h = p.length() - RE;
    const shadow = d < 0 ? THREE.MathUtils.smoothstep(perp, RE - 15, RE + 25) : 1;
    const mu = p.clone().normalize().dot(sunLocal);
    const tr = sunTint(h < 100 ? mu + Math.acos(Math.min(1, RE / (RE + Math.max(0, h)))) * .9 : 1);
    sunLight.color.setRGB(tr[0], tr[1], tr[2]); sunLight.intensity = 3.2 * shadow;
    const dayGround = THREE.MathUtils.smoothstep(mu, -.15, .2);
    const skyAmt = THREE.MathUtils.smoothstep(-h, -60, 0) * dayGround;
    hemi.color.setRGB(.35, .55, .95); hemi.groundColor.setRGB(.05, .14, .26);
    hemi.intensity = .06 + .9 * skyAmt + .25 * dayGround * (1 - skyAmt);
    fgScene.environmentIntensity = .15 + .6 * dayGround;
    // 星空：白昼大气中隐去
    const camH = camLocal.length() - RE, camMu = camLocal.clone().normalize().dot(sunLocal);
    stars.material.uniforms.uVis.value = 1 - THREE.MathUtils.smoothstep(camMu, -.18, .05) * THREE.MathUtils.smoothstep(-camH, -70, -10);
    earth.clouds.visible = state.layers.clouds;
  }

  // 标注与标记点
  const projV = v3();
  function updateLabels(t, camLocal) {
    const rect = canvas.getBoundingClientRect();
    const occluded = p => {
      // 地球遮挡：相机→点 的线段与地球相交
      const d = p.clone().sub(camLocal), L = d.length(); d.divideScalar(L);
      const b = camLocal.dot(d), c = camLocal.lengthSq() - (RE - 1) * (RE - 1), disc = b * b - c;
      if (disc < 0) return false; const s = -b - Math.sqrt(disc);
      return s > 0 && s < L - 1;
    };
    const st = objState('stack', t), itc = objState('interceptor', t);
    for (const l of labelDefs) {
      let p = l.pos ? l.pos() : null, show = state.layers.labels && (!l.layer || state.layers[l.layer]) && (!l.after || t > l.after);
      if (l.id === 'vehicle') { p = st.p; l.b.textContent = st.name; l.small.textContent = `${st.h.toFixed(0)} km · ${st.v.toFixed(2)} km/s`; show = show && t < D.tI + 30; }
      if (l.id === 'itc') { p = itc.p; show = show && t >= D.tL && t < D.tI; l.small.textContent = `${itc.h.toFixed(1)} km · ${itc.v.toFixed(2)} km/s`; }
      if (!p || !show) { l.el.style.display = 'none'; continue; }
      const dist = p.distanceTo(camLocal);
      if (dist < (l.id === 'vehicle' || l.id === 'itc' ? 3 : 8) || occluded(p)) { l.el.style.display = 'none'; continue; }
      projV.copy(p).applyMatrix4(fgEarth.matrixWorld).project(camera);
      if (projV.z > 1 || Math.abs(projV.x) > 1.1 || Math.abs(projV.y) > 1.1) { l.el.style.display = 'none'; continue; }
      l.el.style.display = 'block';
      l.el.style.transform = `translate(${(projV.x * .5 + .5) * rect.width + 9}px, ${(-projV.y * .5 + .5) * rect.height}px) translateY(-50%)`;
      l.el.style.left = '0'; l.el.style.top = '0';
    }
    // 标记点
    const list = [
      [st.p, [1, .45, .3], 7, t < D.tI],
      [itc.p, [.45, .95, 1], 6, t >= D.tL && t < D.tI],
      [site, [1, .5, .4], 5, true],
      [ship, [.45, .95, 1], 5, true],
      [satPos, [.8, .65, 1], 6, true],
      [impactP, [1, .78, .4], 5, true],
      [PIthree, [1, .85, .5], 8, t >= D.tI && t < D.tI + 60],
      [pbvObj.wrap.position, [.8, .8, .8], 4, pbvObj.wrap.visible],
    ];
    list.forEach(([p, c, s, vis], i) => {
      const dist = p.distanceTo(camLocal);
      markers.set(i, p, c, s, vis ? THREE.MathUtils.smoothstep(dist, 4, 40) : 0);
    });
    markers.points.geometry.attributes.position.needsUpdate = true;
    markers.points.geometry.attributes.color.needsUpdate = true;
    markers.points.geometry.attributes.size.needsUpdate = true;
    // 跟踪准星（雷达跟踪期间）
    const ret = $('#reticle');
    if (t >= D.tAcq && t < D.tI && state.layers.sensors) {
      projV.copy(objState('stack', t).p).applyMatrix4(fgEarth.matrixWorld).project(camera);
      if (projV.z < 1) { ret.style.display = 'block'; ret.style.left = `${(projV.x * .5 + .5) * rect.width - 27}px`; ret.style.top = `${(-projV.y * .5 + .5) * rect.height - 27}px`; }
      else ret.style.display = 'none';
    } else ret.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 主循环
  // ---------------------------------------------------------------------------
  let last = performance.now(), wall = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now; wall += dt;
    const target = state.speedMode === 'auto' ? autoSpeed(state.t) : state.speed;
    state.speedNow = Math.exp(Math.log(state.speedNow) + (Math.log(target) - Math.log(state.speedNow)) * Math.min(1, dt * 3));
    if (state.playing) {
      state.t = Math.min(S.t1, state.t + dt * state.speedNow);
      if (state.t >= S.t1) setPlaying(false);
    }
    const t = state.t;
    updateWorld(t, wall);
    const spec = updateRig(dt, t);
    controls.update();
    fgScene.updateMatrixWorld(); bgScene.updateMatrixWorld();
    // 相机不进入海面以下
    const camLocal = fgEarth.worldToLocal(camera.position.clone());
    if (camLocal.length() < RE + .0025) {
      camLocal.setLength(RE + .0025);
      camera.position.copy(camLocal.clone().applyMatrix4(fgEarth.matrixWorld));
      fgScene.updateMatrixWorld();
    }
    const focusLocal = fgEarth.worldToLocal(new THREE.Vector3());
    updateLighting(focusLocal, camLocal);
    Object.entries(layers).forEach(([k, g]) => { g.visible = state.layers[k]; });
    updateLabels(t, camLocal);
    const radar = D.radarSees(S.rv.position(Math.max(t, ST.tRelease)));
    const hudO = spec.o ?? objState(state.cam === 'auto' ? 'stack' : 'stack', t);
    ui.update(t, state.speedNow, { playing: state.playing, radar: t >= D.tAcq && t < D.tI ? radar : null, hud: hudO });
    $('#timeline').value = ((t - S.t0) / (S.t1 - S.t0) * 10000).toFixed(0);
    composer.render();
  }

  // ---------------------------------------------------------------------------
  // 交互
  // ---------------------------------------------------------------------------
  function setPlaying(p) { state.playing = p; $('#playBtn').textContent = p ? 'Ⅱ' : '▶'; }
  function seek(t) { state.t = THREE.MathUtils.clamp(t, S.t0, S.t1); ui.lastEv = S.events.findLastIndex?.(e => e.t <= state.t) ?? -1; }
  let toastTimer;
  function toast(e) {
    const el = $('#toast'); el.innerHTML = `${e.label}${e.detail ? `<small>${e.detail}</small>` : ''}`; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  $('#playBtn').addEventListener('click', () => { if (state.t >= S.t1) state.t = S.t0; setPlaying(!state.playing); });
  $('#resetBtn').addEventListener('click', () => { seek(S.t0); setPlaying(false); });
  $('#stepBtn').addEventListener('click', () => { const n = S.events.find(e => e.t > state.t + 1); seek(n ? n.t - 1.5 : S.t1); });
  $('#timeline').addEventListener('input', e => { seek(S.t0 + (+e.target.value / 10000) * (S.t1 - S.t0)); });
  document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    state.speedMode = b.dataset.speed === 'auto' ? 'auto' : 'manual'; state.speed = +b.dataset.speed || 1;
    document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('active', x === b));
  }));
  document.querySelectorAll('[data-layer]').forEach(i => i.addEventListener('change', () => { state.layers[i.dataset.layer] = i.checked; }));
  const camBtns = document.querySelectorAll('[data-cam]');
  function setCam(mode) {
    state.cam = mode; camBtns.forEach(b => b.classList.toggle('active', b.dataset.cam === mode));
    if (mode === 'chase') { const o = state.chase === 'auto' ? director(state.t)[1] || 'stack' : state.chase; setView('chase', o, baseDist[o] ?? .05); }
    if (mode === 'globe') setView('globe', null, 30000);
    if (mode === 'region') setView('region', null, 3400);
  }
  camBtns.forEach(b => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('#chaseTarget').addEventListener('change', e => { state.chase = e.target.value; if (state.chase === 'auto') setCam('auto'); else setCam('chase'); });
  $('#drawerBtn').addEventListener('click', () => $('#knowledgeDrawer').classList.toggle('open'));
  window.addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { e.preventDefault(); $('#playBtn').click(); } });

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    fgScene.traverse(o => { if (o.material?.isLineMaterial) o.material.resolution.set(r.width * pr, r.height * pr); });
    sunSprite.material.uniforms.uRes.value.set(r.width * pr, r.height * pr);
    markers.points.material.uniforms.uScale.value = pr;
  }
  window.addEventListener('resize', resize); resize();
  setView('chase', 'stack', .085);
  camera.position.set(-.062, .007, -.05);
  controls.update();
  $('#loading').classList.add('done');
  requestAnimationFrame(frame);
  window.__sim = { S, state, camera, seek, setPlaying };
}

// -----------------------------------------------------------------------------
// 辅助构造
// -----------------------------------------------------------------------------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function sunTint(mu) {
  const m = 1 / Math.max(.035, mu + .15 * Math.pow(Math.max(1e-3, 93.885 - Math.acos(Math.min(1, Math.max(-1, mu))) * 180 / Math.PI), -1.253));
  const tau = [5.802e-3 * 8 + 4.4e-3 * 1.2, 13.558e-3 * 8 + 4.4e-3 * 1.2, 33.1e-3 * 8 + 4.4e-3 * 1.2];
  return tau.map(x => Math.exp(-x * m));
}

function envScene() {
  const s = new THREE.Scene();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = y > 0. ? mix(vec3(.55,.62,.7), vec3(.18,.32,.6), pow(y,.6)) : mix(vec3(.25,.3,.34), vec3(.03,.08,.13), pow(-y,.4)); gl_FragColor = vec4(c,1.); }',
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
  return s;
}

function makeStars() {
  const N = 9000, pos = [], col = [], mag = [];
  const r = mulberry(42);
  // 银河面：倾斜大圆附近星密度更高
  const gp = new THREE.Vector3(.3, .85, -.42).normalize();
  for (let i = 0; i < N; i++) {
    let d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    if (i > N * .55) { d.addScaledVector(gp, -d.dot(gp) * (.85 + r() * .15)).normalize(); }
    pos.push(d.x * 1e6, d.y * 1e6, d.z * 1e6);
    const m = -1 + Math.pow(r(), .35) * 7.5;
    mag.push(m);
    const T = r();
    const c = T < .15 ? [.7, .8, 1] : T < .5 ? [.95, .96, 1] : T < .8 ? [1, .95, .85] : [1, .82, .65];
    col.push(...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('mag', new THREE.Float32BufferAttribute(mag, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uVis: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${LOGDEPTH_VERT_PARS} attribute float mag; attribute vec3 color; varying vec3 vC; uniform float uVis;
      void main(){ float b = pow(2.512, -mag) ; vC = color * min(1.6, b * 1.4) * uVis; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_PointSize = clamp(1.2 + b * 1.6, 1.2, 4.); ${LOGDEPTH_VERT} }`,
    fragmentShader: `${LOGDEPTH_FRAG_PARS} varying vec3 vC; void main(){ ${LOGDEPTH_FRAG} float r = length(gl_PointCoord - .5) * 2.; gl_FragColor = vec4(vC * exp(-r * r * 3.), 1.); }`,
  });
  const p = new THREE.Points(g, mat); p.renderOrder = -20; p.frustumCulled = false;
  return p;
}

function makeMarkers(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
  g.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${LOGDEPTH_VERT_PARS} attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC;
      void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_PointSize = size * 3. * uScale; ${LOGDEPTH_VERT} }`,
    fragmentShader: `${LOGDEPTH_FRAG_PARS} varying vec4 vC; void main(){ ${LOGDEPTH_FRAG} float r = length(gl_PointCoord - .5) * 2.; float a = exp(-r * r * 9.) * 2.5 + exp(-r * r * 2.) * .5; a *= 1. - smoothstep(.85, 1., r); gl_FragColor = vec4(vC.rgb * a * vC.a, 1.); }`,
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 10;
  return {
    points,
    set(i, p, c, s, a) { g.attributes.position.setXYZ(i, p.x, p.y, p.z); g.attributes.color.setXYZW(i, c[0], c[1], c[2], a); g.attributes.size.setX(i, s); },
  };
}

function makeSheath() {
  // 再入体等离子鞘：沿外形略放大的发光壳，菲涅尔边缘与前缘更亮
  const pts = [new THREE.Vector2(.31, -.02), new THREE.Vector2(.23, .85), new THREE.Vector2(.1, 1.72), new THREE.Vector2(.06, 1.8), new THREE.Vector2(.001, 1.83)];
  const geo = new THREE.LatheGeometry(pts, 48);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `${LOGDEPTH_VERT_PARS} varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; ${LOGDEPTH_VERT} }`,
    fragmentShader: `${LOGDEPTH_FRAG_PARS} uniform float uI, uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ ${LOGDEPTH_FRAG} float f = 1. - abs(dot(normalize(vN), normalize(vV))); float nose = smoothstep(1.2, 1.83, vY);
        float flick = .85 + .15 * sin(uTime * 60. + vY * 20.);
        vec3 c = mix(vec3(1.4, .5, .18), vec3(2.6, 2.1, 1.7), nose);
        gl_FragColor = vec4(c * (pow(f, 1.5) * .9 + nose * 1.4) * uI * flick, 1.); }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false;
  return m;
}
