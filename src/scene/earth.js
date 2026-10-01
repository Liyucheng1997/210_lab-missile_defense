// 地球：昼夜照明、海洋镜面反射、程序化云层、单次散射大气、近景海面
import * as THREE from 'three';
import { RE } from '../sim/environment.js';
import { LOGDEPTH_VERT_PARS, LOGDEPTH_VERT, LOGDEPTH_FRAG_PARS, LOGDEPTH_FRAG, NOISE, SUN_TINT } from './glsl.js';

export const ATM_TOP = RE + 90;

const ATMOS_COMMON = /* glsl */`
uniform vec3 uSun; uniform vec3 uCam;
const float RE_ = ${RE.toFixed(1)}, RA_ = ${ATM_TOP.toFixed(1)};
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float BM = 3.996e-3, BME = 4.40e-3, HR = 8.0, HM = 1.2;
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b=dot(ro,rd); float c=dot(ro,ro)-r*r; float d=b*b-c; if(d<0.) return vec2(1e9,-1e9); d=sqrt(d); return vec2(-b-d,-b+d); }
`;

export function createEarth(loader) {
  const group = new THREE.Group();          // 地固系（随自转旋转）
  const uniforms = {
    uSun: { value: new THREE.Vector3(1, 0, 0) }, uCam: { value: new THREE.Vector3() }, uTime: { value: 0 },
    dayMap: { value: null }, specMap: { value: null }, normalMap: { value: null }, uReady: { value: 0 },
  };
  const day = loader.load('assets/earth_atmos_2048.jpg', t => { uniforms.uReady.value = 1; });
  day.colorSpace = THREE.SRGBColorSpace; day.anisotropy = 8;
  uniforms.dayMap.value = day;
  uniforms.specMap.value = loader.load('assets/earth_specular_2048.jpg');
  uniforms.normalMap.value = loader.load('assets/earth_normal_2048.jpg');

  const earthMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      ${LOGDEPTH_VERT_PARS}
      varying vec3 vLocal; varying vec2 vUv;
      void main(){ vLocal = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); ${LOGDEPTH_VERT} }`,
    fragmentShader: /* glsl */`
      ${LOGDEPTH_FRAG_PARS}
      uniform sampler2D dayMap, specMap, normalMap; uniform vec3 uSun, uCam; uniform float uTime, uReady;
      varying vec3 vLocal; varying vec2 vUv;
      ${NOISE}
      ${SUN_TINT}
      void main(){
        ${LOGDEPTH_FRAG}
        vec3 n = normalize(vLocal);
        vec3 east = normalize(cross(vec3(0.,1.,0.), n)); vec3 north = cross(n, east);
        vec3 tn = texture2D(normalMap, vUv).xyz * 2. - 1.;
        float water = texture2D(specMap, vUv).r;
        vec3 N = normalize(east * tn.x * .7 + north * tn.y * .7 + n * tn.z);
        N = normalize(mix(N, n, water));
        vec3 albedo = texture2D(dayMap, vUv).rgb;
        albedo = mix(vec3(.05,.08,.1), albedo, uReady);
        // 海洋色彩校正：更深、更蓝
        albedo = mix(albedo, albedo * vec3(.55,.75,1.05) * .8, water);
        // 近距离细节噪声（陆地）
        float camDist = length(uCam - vLocal);
        float detail = fbm(vLocal * .35, 4) * .18 * (1. - water) * smoothstep(1800., 200., camDist);
        albedo *= 1. + detail;
        float mu = dot(n, uSun);
        float NdL = max(dot(N, uSun), 0.) * smoothstep(-.12, .05, mu);
        vec3 sunCol = sunTransmittance(max(mu, 0.)) * 3.2;
        vec3 col = albedo * NdL * sunCol;
        // 海面耀斑（GGX 近似，粗糙度随距离增大）
        vec3 V = normalize(uCam - vLocal); vec3 H = normalize(V + uSun);
        float NdH = max(dot(n, H), 0.), rough = mix(.07, .22, smoothstep(300., 8000., camDist));
        float a2 = rough * rough; float d = NdH * NdH * (a2 - 1.) + 1.; float D = a2 / (3.14159 * d * d);
        float F = .02 + .98 * pow(1. - max(dot(V, H), 0.), 5.);
        col += water * D * F * .25 * sunCol * max(dot(n, uSun), 0.) * smoothstep(0., .1, dot(n, V));
        // 夜面：极弱的地照/星光
        col += albedo * .006 * vec3(.5,.6,1.) * (1. - smoothstep(-.2, .05, mu));
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RE, 360, 180), earthMat);
  earth.renderOrder = -10;
  group.add(earth);

  // ---------- 云层 ----------
  const cloudUniforms = { uSun: uniforms.uSun, uCam: uniforms.uCam, uTime: uniforms.uTime, uClear: { value: [new THREE.Vector3(), new THREE.Vector3()] } };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${LOGDEPTH_VERT_PARS}
      varying vec3 vLocal;
      void main(){ vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); ${LOGDEPTH_VERT} }`,
    fragmentShader: /* glsl */`
      ${LOGDEPTH_FRAG_PARS}
      uniform vec3 uSun, uCam, uClear[2]; uniform float uTime;
      varying vec3 vLocal;
      ${NOISE}
      ${SUN_TINT}
      float cloud(vec3 p){
        vec3 q = p / ${RE.toFixed(1)};
        float lat = q.y;
        vec3 w = vec3(fbm(q * 3. + vec3(0., uTime * .00002, 0.), 3), fbm(q * 3. + 7.1, 3), fbm(q * 3. + 3.3, 3));
        float c = fbm(q * 5.5 + w * .9, 6) * .6 + fbm(q * 22. + w * .4, 4) * .35;
        // 纬向环流带：赤道辐合带与西风带更多云
        float band = .55 + .25 * exp(-pow(lat / .12, 2.)) + .2 * exp(-pow((abs(lat) - .78) / .12, 2.)) - .25 * exp(-pow((abs(lat) - .42) / .1, 2.));
        float cov = smoothstep(.62 - band * .5, .95 - band * .5, c + .35);
        for (int i = 0; i < 2; i++) cov *= smoothstep(60., 220., length(p - uClear[i]));
        return cov;
      }
      void main(){
        ${LOGDEPTH_FRAG}
        vec3 n = normalize(vLocal);
        float cov = cloud(vLocal);
        if (cov < .01) discard;
        float mu = dot(n, uSun);
        vec3 sunCol = sunTransmittance(max(mu, 0.)) * 3.2;
        float lit = smoothstep(-.1, .08, mu);
        // 自阴影近似：沿太阳方向偏移采样
        float sh = cloud(vLocal + uSun * 25.);
        vec3 col = vec3(.92) * (max(mu, 0.) * .8 + .2) * sunCol * lit * (1. - sh * .35) + vec3(.004,.006,.012);
        float viewFade = smoothstep(0., 6., abs(length(uCam) - length(vLocal)));
        gl_FragColor = vec4(col, cov * .92 * viewFade);
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(RE + 7, 256, 128), cloudMat);
  clouds.renderOrder = -8;
  group.add(clouds);

  // ---------- 大气（单次散射光线步进） ----------
  const atmMat = new THREE.ShaderMaterial({
    uniforms: { uSun: uniforms.uSun, uCam: uniforms.uCam, uIntensity: { value: 22 } },
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    vertexShader: /* glsl */`
      varying vec3 vLocal;
      void main(){ vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w * .999999; }`,
    fragmentShader: /* glsl */`
      ${ATMOS_COMMON}
      uniform float uIntensity;
      varying vec3 vLocal;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 rd = normalize(vLocal - uCam);
        vec2 a = raySphere(uCam, rd, RA_);
        if (a.x > a.y || a.y < 0.) discard;
        vec2 e = raySphere(uCam, rd, RE_);
        float t0 = max(a.x, 0.), t1 = a.y;
        if (e.x < e.y && e.y > 0.) t1 = min(t1, max(e.x, 0.));
        const int N = 22; const int M = 6;
        float seg = (t1 - t0) / float(N);
        float jit = hash(gl_FragCoord.xy);
        vec3 sumR = vec3(0.), sumM = vec3(0.); float odR = 0., odM = 0.;
        float mu = dot(rd, uSun);
        float pR = .0596831 * (1. + mu * mu);
        float g = .78; float pM = .1193662 * ((1. - g*g) * (1. + mu*mu)) / ((2. + g*g) * pow(1. + g*g - 2.*g*mu, 1.5));
        for (int i = 0; i < N; i++) {
          vec3 p = uCam + rd * (t0 + seg * (float(i) + jit));
          float h = length(p) - RE_;
          float hr = exp(-h / HR) * seg, hm = exp(-h / HM) * seg;
          odR += hr; odM += hm;
          vec2 l = raySphere(p, uSun, RA_);
          float ls = l.y / float(M); float lR = 0., lM = 0.; bool lit = true;
          for (int j = 0; j < M; j++) {
            vec3 q = p + uSun * ls * (float(j) + .5);
            float hq = length(q) - RE_;
            if (hq < 0.) { lit = false; break; }
            lR += exp(-hq / HR) * ls; lM += exp(-hq / HM) * ls;
          }
          if (lit) {
            vec3 att = exp(-(BR * (odR + lR) + BME * (odM + lM)));
            sumR += att * hr; sumM += att * hm;
          }
        }
        vec3 inscatter = uIntensity * (sumR * BR * pR + sumM * BM * pM);
        vec3 tr = exp(-(BR * odR + BME * odM));
        gl_FragColor = vec4(inscatter, dot(tr, vec3(.3333)));
      }`,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATM_TOP * 1.02, 128, 64), atmMat);
  atmosphere.renderOrder = -5;
  atmosphere.frustumCulled = false;
  group.add(atmosphere);

  return { group, earth, clouds, atmosphere, uniforms, cloudUniforms };
}

/** 近景海面：以站点为中心的高密度径向网格，程序化波浪与天空反射 */
export function createOceanPatch(centerThree, uniforms, radiusKm = 260) {
  const up = centerThree.clone().normalize();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east);
  const rings = 140, segs = 160, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = .002 * Math.pow(radiusKm / .002, i / rings);       // 2 m → radiusKm 对数分布
    for (let j = 0; j < segs; j++) {
      const a = j / segs * Math.PI * 2;
      const ang = r / RE;
      const p = up.clone().multiplyScalar(Math.cos(ang)).add(east.clone().multiplyScalar(Math.sin(ang) * Math.cos(a))).add(north.clone().multiplyScalar(Math.sin(ang) * Math.sin(a))).multiplyScalar(RE);
      p.sub(centerThree.clone().normalize().multiplyScalar(RE));
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + (j + 1) % segs);
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const base = up.clone().multiplyScalar(RE);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: uniforms.uSun, uCam: uniforms.uCam, uTime: uniforms.uTime,
      uBase: { value: base }, uEast: { value: east }, uNorth: { value: north }, uRadius: { value: radiusKm }, uFlash: { value: new THREE.Vector4() },
    },
    transparent: true, depthWrite: true,
    vertexShader: /* glsl */`
      ${LOGDEPTH_VERT_PARS}
      varying vec3 vRel;
      void main(){ vRel = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); ${LOGDEPTH_VERT} }`,
    fragmentShader: /* glsl */`
      ${LOGDEPTH_FRAG_PARS}
      uniform vec3 uSun, uCam, uBase, uEast, uNorth; uniform float uTime, uRadius; uniform vec4 uFlash;
      varying vec3 vRel;
      ${NOISE}
      ${SUN_TINT}
      vec2 waveGrad(vec2 x, float lod){
        // 多方向 Gerstner 风格波面梯度（单位：米）
        vec2 g = vec2(0.);
        const int K = 9;
        for (int i = 0; i < K; i++) {
          float fi = float(i);
          float ang = .35 + fi * 2.399; vec2 d = vec2(cos(ang), sin(ang));
          float lambda = 140. * pow(.62, fi); float k = 6.2832 / lambda;
          float w = sqrt(9.81 * k); float amp = .055 * lambda * .14;
          float fade = 1. - smoothstep(lambda * 40., lambda * 160., lod);
          g += d * k * amp * cos(dot(d, x) * k - w * uTime) * fade;
        }
        return g;
      }
      void main(){
        ${LOGDEPTH_FRAG}
        vec3 p = uBase + vRel;
        vec3 n0 = normalize(p);
        vec2 x = vec2(dot(vRel, uEast), dot(vRel, uNorth)) * 1000.;
        float dist = length(uCam - p) * 1000.;
        vec2 gr = waveGrad(x, dist) + vec2(snoise(vec3(x * .02, uTime * .05)), snoise(vec3(x * .02 + 31., uTime * .05))) * .05 * (1. - smoothstep(500., 4000., dist));
        vec3 N = normalize(n0 - uEast * gr.x - uNorth * gr.y);
        vec3 V = normalize(uCam - p);
        float mu = dot(n0, uSun);
        vec3 sunCol = sunTransmittance(max(mu, 0.)) * 3.2;
        float day = smoothstep(-.12, .05, mu);
        float F = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
        vec3 R = reflect(-V, N);
        float re = max(dot(R, n0), 0.);
        vec3 skyZen = vec3(.05, .13, .32) * day + vec3(.002,.003,.008);
        vec3 skyHor = mix(vec3(.35,.45,.6), vec3(.9,.45,.2), 1. - smoothstep(.0, .25, mu)) * day * .9 + vec3(.004,.005,.01);
        vec3 sky = mix(skyHor, skyZen, pow(re, .45));
        vec3 deep = vec3(.004, .018, .035) * (max(mu, 0.) * 2. + .05) * sunCol;
        vec3 H = normalize(V + uSun);
        float rough = mix(.035, .12, smoothstep(200., 30000., dist));
        float a2 = rough * rough; float NdH = max(dot(N, H), 0.); float d = NdH * NdH * (a2 - 1.) + 1.;
        float spec = a2 / (3.14159 * d * d) * F * max(dot(N, uSun), 0.) * .25;
        vec3 col = mix(deep, sky, F) + spec * sunCol;
        // 泡沫/白帽
        float foam = smoothstep(.55, .8, snoise(vec3(x * .05, uTime * .1))) * .06 * (1. - smoothstep(300., 3000., dist));
        col += foam * (sunCol * max(mu, 0.) + .01);
        // 交会/尾焰闪光照亮海面
        col += vec3(1., .75, .45) * uFlash.w / (1. + pow(length(p - uFlash.xyz) / 6., 2.));
        float r = length(vRel);
        float a = 1. - smoothstep(uRadius * .45, uRadius * .95, r);
        a *= 1. - smoothstep(600., 1600., length(uCam - p) - 0.);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(base).add(up.clone().multiplyScalar(.0015));
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  return mesh;
}
