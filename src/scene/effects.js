// 视觉效果：尾焰、烟迹/辉光粒子、交会闪光、标记点、轨迹线、雷达扇区
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LOGDEPTH_VERT_PARS, LOGDEPTH_VERT, LOGDEPTH_FRAG_PARS, LOGDEPTH_FRAG, NOISE, SUN_TINT } from './glsl.js';
import { RE } from '../sim/environment.js';
import { puffTexture } from './textures.js';

// ---------------------------------------------------------------------------
// 尾焰：三层（核心 / 火焰 / 外层膨胀羽流），形状随环境压力变化
// ---------------------------------------------------------------------------
const plumeVert = /* glsl */`
  ${LOGDEPTH_VERT_PARS}
  uniform float uLen, uR0, uR1, uShape, uTime;
  varying float vS; varying vec3 vN; varying vec3 vView; varying float vAng;
  void main(){
    float s = clamp(-position.y, 0., 1.);
    float r = mix(uR0, uR1, pow(s, uShape));
    vec2 d = normalize(position.xz + 1e-6);
    vec3 p = vec3(d.x * r, -s * uLen, d.y * r);
    vS = s; vAng = atan(d.y, d.x);
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    // 侧壁法线（近似）
    float dr = (uR1 - uR0) * uShape * pow(max(s, 1e-3), uShape - 1.) / uLen;
    vN = normalize(normalMatrix * normalize(vec3(d.x, dr, d.y)));
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    ${LOGDEPTH_VERT}
  }`;
const plumeFrag = /* glsl */`
  ${LOGDEPTH_FRAG_PARS}
  uniform vec3 uColA, uColB; uniform float uIntensity, uTime, uFalloff, uEdge, uSeed;
  varying float vS; varying vec3 vN; varying vec3 vView; varying float vAng;
  ${NOISE}
  void main(){
    ${LOGDEPTH_FRAG}
    float f = abs(dot(normalize(vN), normalize(vView)));
    float edge = pow(f, uEdge);
    float n = snoise(vec3(vS * 9. - uTime * 22., vAng * 1.5, uTime * 3. + uSeed)) * .5 + .5;
    float n2 = snoise(vec3(vS * 30. - uTime * 60., vAng * 4., uSeed)) * .5 + .5;
    float axial = exp(-vS * uFalloff) * smoothstep(0., .015, vS + .002);
    float a = axial * edge * (.65 + .35 * n) * (.85 + .15 * n2) * smoothstep(1., .75, vS);
    vec3 col = mix(uColA, uColB, smoothstep(0., .7, vS + (n - .5) * .15));
    gl_FragColor = vec4(col * a * uIntensity, 1.);
  }`;

export function plumeLayer(colA, colB, seed) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 60, true);
  geo.translate(0, -.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLen: { value: 10 }, uR0: { value: .3 }, uR1: { value: 1 }, uShape: { value: 1 }, uTime: { value: 0 },
      uColA: { value: new THREE.Color(...colA) }, uColB: { value: new THREE.Color(...colB) },
      uIntensity: { value: 1 }, uFalloff: { value: 2 }, uEdge: { value: 1.5 }, uSeed: { value: seed },
    },
    vertexShader: plumeVert, fragmentShader: plumeFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false;
  return m;
}

export class Plume {
  /** scale: 发动机尺度（1 = 一级），单位米 */
  constructor() {
    this.group = new THREE.Group();
    this.core = plumeLayer([3, 2.6, 2.2], [2.4, 1.3, .5], 1);
    this.flame = plumeLayer([2.2, 1.25, .5], [1.2, .38, .1], 2);
    this.outer = plumeLayer([.9, .62, .45], [.35, .32, .38], 3);
    this.group.add(this.outer, this.flame, this.core);
    // 尾焰照明
    this.light = new THREE.PointLight(0xffa860, 0, 0, 2);
    this.light.position.y = -3;
    this.group.add(this.light);
  }
  /** pr: 环境压力比 p/p0；throttle 0..1；size: 喷管出口半径(m)；t: 时间 */
  update(pr, throttle, size, t, kind = 'solid') {
    const on = throttle > .01;
    this.group.visible = on;
    if (!on) { this.light.intensity = 0; return; }
    const vac = 1 - pr, k = size / .58;
    const U = (m, o) => { for (const key in o) m.material.uniforms[key].value = o[key]; m.material.uniforms.uTime.value = t; };
    U(this.core, { uLen: (5 + 10 * vac) * k, uR0: size * .9, uR1: size * (.5 + 1.6 * vac), uShape: 1, uIntensity: 3.2 * throttle, uFalloff: 2.6, uEdge: 2.2 });
    U(this.flame, { uLen: (26 + 90 * vac * vac) * k, uR0: size * .95, uR1: size * (1.8 + 45 * vac * vac * vac), uShape: .55 + .5 * pr, uIntensity: (1.1 + .4 * pr) * throttle, uFalloff: 2.2 + 1.5 * vac, uEdge: 1.4 });
    U(this.outer, { uLen: (55 + 900 * Math.pow(vac, 3)) * k, uR0: size * 1.1, uR1: size * (5 + 520 * Math.pow(vac, 4)), uShape: .35 + .5 * pr, uIntensity: (.18 + .25 * pr) * throttle * (kind === 'small' ? .5 : 1), uFalloff: 2.6, uEdge: .9 });
    // 光源位于缩放后的模型内，距离/强度按世界单位 km 计
    this.light.intensity = .004 * throttle * k * k * (1 + 2 * pr);
    this.light.distance = .6 * k;
  }
}

// ---------------------------------------------------------------------------
// 粒子系统（实例化广告牌，按发射时间在着色器中确定性演化，可随意拖动时间轴）
// ---------------------------------------------------------------------------
export class ParticleSystem {
  /** list: [{p:[x,y,z] (three, km, 相对 anchor), t, v:[..] km/s, s0, grow, life, alpha, seed, kind}] */
  constructor(list, anchor, { additive = false, uniforms } = {}) {
    const n = list.length;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    const A = (k, size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
    const aPos = A('p', 3), aVel = A('v', 3), aT = A('t', 4), aMisc = A('m', 4);
    list.forEach((q, i) => {
      aPos.setXYZ(i, q.p[0], q.p[1], q.p[2]);
      aVel.setXYZ(i, q.v[0], q.v[1], q.v[2]);
      aT.setXYZW(i, q.t, q.life, q.s0, q.grow);
      aMisc.setXYZW(i, q.alpha, q.seed, q.kind, q.heat ?? 0);
    });
    geo.setAttribute('aPos', aPos); geo.setAttribute('aVel', aVel); geo.setAttribute('aT', aT); geo.setAttribute('aMisc', aMisc);
    geo.instanceCount = n;
    this.uniforms = {
      uTime: uniforms.uSimTime, uSun: uniforms.uSun, uAnchor: { value: anchor.clone() },
      map: { value: puffTexture() }, uFade: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        ${LOGDEPTH_VERT_PARS}
        attribute vec3 aPos, aVel; attribute vec4 aT, aMisc;
        uniform float uTime; uniform vec3 uSun, uAnchor;
        varying vec2 vUv; varying vec4 vCol; varying float vSeed;
        ${SUN_TINT}
        void main(){
          float age = uTime - aT.x;
          vUv = uv; vSeed = aMisc.y;
          if (age < 0. || age > aT.y) { gl_Position = vec4(0., 0., -2., 1.); vCol = vec4(0.); return; }
          float kind = aMisc.z;
          vec3 c = aPos + aVel * age;
          if (kind > 1.5) c += normalize(uAnchor + aPos) * (-.0049 * age * age);      // 碎片/火花受重力下坠
          float size = aT.z + aT.w * sqrt(age);
          vec4 mv = modelViewMatrix * vec4(c, 1.);
          float rot = aMisc.y * 6.283 + age * (fract(aMisc.y * 7.) - .5) * .3;
          vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          mv.xy += q * size;
          gl_Position = projectionMatrix * mv;
          ${LOGDEPTH_VERT}
          float life = aT.y;
          float alpha = aMisc.x * smoothstep(0., .25, age + .05) * (1. - smoothstep(life * .55, life, age));
          if (kind < 1.5) {
            // 烟：受日照（含地影/曙暮光），新烟被尾焰照亮
            vec3 P = uAnchor + c; vec3 up = normalize(P);
            float h = length(P) - ${RE.toFixed(1)};
            float dip = acos(clamp(${RE.toFixed(1)} / (${RE.toFixed(1)} + max(h, 0.)), 0., 1.));
            float el = asin(clamp(dot(up, uSun), -1., 1.));
            float lit = smoothstep(-dip - .015, -dip + .02, el);
            vec3 sunC = sunTransmittance(max(sin(el + dip * .9), .0)) * 2.4;
            float shade = .55 + .45 * fract(aMisc.y * 13.);
            vec3 col = vec3(.86, .85, .83) * shade * (sunC * lit * .9 + vec3(.05, .07, .1) * (.15 + .85 * smoothstep(-.1, .2, el)));
            col += vec3(2.6, 1.2, .35) * exp(-age * 2.2) * (1. - kind);
            alpha *= mix(1., .35, smoothstep(10., 60., h)) * min(1., aT.z * 3. / size + .25);
            vCol = vec4(col, alpha);
          } else {
            // 辉光：再入电离尾迹/碎片火花，随冷却由白→橙→暗红
            float heat = aMisc.w * exp(-age / max(.2, life * .35));
            vec3 col = mix(vec3(1.2, .18, .03), vec3(3.2, 2.2, 1.2), clamp(heat, 0., 1.)) * (heat * 2. + .2);
            vCol = vec4(col * alpha, alpha);
          }
        }`,
      fragmentShader: /* glsl */`
        ${LOGDEPTH_FRAG_PARS}
        uniform sampler2D map; uniform float uFade;
        varying vec2 vUv; varying vec4 vCol; varying float vSeed;
        void main(){
          ${LOGDEPTH_FRAG}
          if (vCol.a <= .001) discard;
          vec2 uv = vUv;
          float m = texture2D(map, uv).a;
          float r = length(uv - .5) * 2.;
          float soft = 1. - smoothstep(.55, 1., r);
          ${additive ? 'gl_FragColor = vec4(vCol.rgb * soft * soft * uFade, 1.);' : 'gl_FragColor = vec4(vCol.rgb, vCol.a * m * soft * 1.6 * uFade);'}
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.position.copy(anchor);
    this.count = n;
  }
}

// ---------------------------------------------------------------------------
// 广告牌辉光（太阳、闪光、远景标记），像素/世界尺寸可选
// ---------------------------------------------------------------------------
export function glowSprite(color, { size = 1, worldSize = true, intensity = 1, core = .25 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uIntensity: { value: intensity }, uCore: { value: core }, uWorld: { value: worldSize ? 1 : 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${LOGDEPTH_VERT_PARS}
      uniform float uSize, uWorld; uniform vec2 uRes; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.);
        if (uWorld > .5) { mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }
        else { gl_Position = projectionMatrix * mv; gl_Position.xy += position.xy * uSize * 2. / uRes * gl_Position.w; }
        ${LOGDEPTH_VERT}
      }`,
    fragmentShader: /* glsl */`
      ${LOGDEPTH_FRAG_PARS}
      uniform vec3 uColor; uniform float uIntensity, uCore; varying vec2 vUv;
      void main(){
        ${LOGDEPTH_FRAG}
        float r = length(vUv - .5) * 2.;
        float g = exp(-r * r * 6.) * .6 + exp(-r * r / (uCore * uCore)) + .08 * exp(-r * 3.);
        g *= 1. - smoothstep(.8, 1., r);
        gl_FragColor = vec4(uColor * g * uIntensity, 1.);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------
// 轨迹线（Line2，支持“已飞过”部分高亮）
// ---------------------------------------------------------------------------
export function makeLine(points, anchor, { color = 0xffffff, width = 2, opacity = 1, dashed = false, dashSize = 30, gapSize = 20, worldUnits = false } = {}) {
  const pos = [];
  for (const p of points) pos.push(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
  const geo = new LineGeometry(); geo.setPositions(pos);
  const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, dashed, dashSize, gapSize, worldUnits, depthWrite: false });
  const line = new Line2(geo, mat);
  if (dashed) line.computeLineDistances();
  line.position.copy(anchor);
  line.frustumCulled = false;
  line.userData.segments = points.length - 1;
  return line;
}

/** 两点动态线（雷达波束 / 视线） */
export class DynamicLine {
  constructor(anchor, opts) {
    this.anchor = anchor.clone();
    this.line = makeLine([anchor, anchor.clone().addScalar(1)], anchor, opts);
  }
  set(a, b) {
    const A = this.anchor;
    this.line.geometry.setPositions([a.x - A.x, a.y - A.y, a.z - A.z, b.x - A.x, b.y - A.y, b.z - A.z]);
    if (this.line.material.dashed) this.line.computeLineDistances();
  }
}

// ---------------------------------------------------------------------------
// 雷达覆盖扇区（球扇形壳 + 扫描带）
// ---------------------------------------------------------------------------
export function radarFan(radarPos, up, boresight, range, { azHalf = 60, elMax = 75, color = 0x6ee8f3 } = {}) {
  const right = new THREE.Vector3().crossVectors(boresight, up).normalize();
  const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
  const pos = [], uv = [], idx = [];
  const NA = 64, NE = 24;
  const dirAt = (az, el) => fwd.clone().multiplyScalar(Math.cos(el) * Math.cos(az)).add(right.clone().multiplyScalar(Math.cos(el) * Math.sin(az))).add(up.clone().multiplyScalar(Math.sin(el)));
  // 外壳
  for (let i = 0; i <= NA; i++) for (let j = 0; j <= NE; j++) {
    const az = (i / NA * 2 - 1) * azHalf * Math.PI / 180, el = j / NE * elMax * Math.PI / 180;
    const d = dirAt(az, el).multiplyScalar(range);
    pos.push(d.x, d.y, d.z); uv.push(i / NA, j / NE);
  }
  for (let i = 0; i < NA; i++) for (let j = 0; j < NE; j++) { const a = i * (NE + 1) + j, b = a + NE + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // 两侧扇面
  const base = pos.length / 3;
  for (const s of [-1, 1]) {
    const o = pos.length / 3;
    for (let r = 0; r <= 12; r++) for (let j = 0; j <= NE; j++) {
      const d = dirAt(s * azHalf * Math.PI / 180, j / NE * elMax * Math.PI / 180).multiplyScalar(range * r / 12);
      pos.push(d.x, d.y, d.z); uv.push(s < 0 ? -1 : 2, r / 12);
    }
    for (let r = 0; r < 12; r++) for (let j = 0; j < NE; j++) { const a = o + r * (NE + 1) + j, b = a + NE + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  void base;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `${LOGDEPTH_VERT_PARS} varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); ${LOGDEPTH_VERT} }`,
    fragmentShader: /* glsl */`
      ${LOGDEPTH_FRAG_PARS}
      uniform vec3 uColor; uniform float uTime, uOpacity; varying vec2 vUv;
      void main(){
        ${LOGDEPTH_FRAG}
        float a;
        if (vUv.x < -.5 || vUv.x > 1.5) { a = .05 * (1. - vUv.y * .6) + .08 * smoothstep(.97, 1., vUv.y); }
        else {
          float grid = max(smoothstep(.96, 1., fract(vUv.x * 12.)), smoothstep(.94, 1., fract(vUv.y * 6.)));
          float sweep = fract(uTime * .25);
          float band = exp(-pow((vUv.x - sweep) * 18., 2.));
          a = .025 + grid * .05 + band * .18;
          a *= 1. - vUv.y * .5;
        }
        gl_FragColor = vec4(uColor * a * uOpacity, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(radarPos);
  mesh.frustumCulled = false;
  return mesh;
}

/** 地表圆环（落区散布椭圆、站点范围） */
export function surfaceRing(centerThree, radiusKm, anchorUp = .3, opts = {}) {
  const up = centerThree.clone().normalize();
  const e = new THREE.Vector3(0, 1, 0).cross(up).normalize(), n = up.clone().cross(e);
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const a = i / 96 * Math.PI * 2, ang = radiusKm / RE;
    pts.push(up.clone().multiplyScalar(Math.cos(ang)).add(e.clone().multiplyScalar(Math.sin(ang) * Math.cos(a) * (opts.sx ?? 1))).add(n.clone().multiplyScalar(Math.sin(ang) * Math.sin(a) * (opts.sy ?? 1))).normalize().multiplyScalar(RE + anchorUp));
  }
  return makeLine(pts, centerThree, opts);
}
