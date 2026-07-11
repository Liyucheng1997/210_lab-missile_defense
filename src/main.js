import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const phases = [
  { name: '任务规划', en: 'PLAN', start: 0, end: .08 },
  { name: '发射与助推', en: 'BOOST', start: .08, end: .25 },
  { name: '中段飞行', en: 'MIDCOURSE', start: .25, end: .58 },
  { name: '再入过渡', en: 'REENTRY', start: .58, end: .72 },
  { name: '防御跟踪', en: 'TRACK', start: .72, end: .84 },
  { name: '末段交会', en: 'INTERCEPT', start: .84, end: .96 },
  { name: '任务评估', en: 'ASSESS', start: .96, end: 1.01 },
];
const chain = ['预警', '探测', '跟踪', '交战'];
const state = { progress: 0, playing: false, speed: 1, last: performance.now(), layers: { trajectory:true, uncertainty:true, defense:true, labels:true } };

const phaseList = document.querySelector('#phaseList');
phases.forEach((p,i)=> phaseList.insertAdjacentHTML('beforeend', `<div class="phase-item" data-phase="${i}"><span class="num">0${i+1}</span><b>${p.name}</b><small>${p.en}</small></div>`));
document.querySelector('#defenseChain').innerHTML = chain.map((x,i)=>`<div class="chain-item" data-chain="${i}"><i></i><b>${x}</b></div>`).join('');
document.querySelector('#timelineLabels').innerHTML = ['T+00','助推','中段','再入','交会','评估'].map(x=>`<span>${x}</span>`).join('');
document.querySelector('#eventLine').innerHTML = '<i></i>'.repeat(18);

const canvas = document.querySelector('#globe');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02060a, .018);
const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
camera.position.set(0.8, 1.7, 8.7);
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = .06; controls.minDistance = 5.2; controls.maxDistance = 13; controls.enablePan = false; controls.autoRotate = true; controls.autoRotateSpeed = .22;

scene.add(new THREE.HemisphereLight(0xb8dcf2, 0x173049, 1.65));
scene.add(new THREE.AmbientLight(0x85a9bf, 1.05));
const sun = new THREE.DirectionalLight(0xfff5df, 4.15); sun.position.set(-5,3,7); scene.add(sun);
const rim = new THREE.DirectionalLight(0x5aafff, 2.0); rim.position.set(5,-1,-5); scene.add(rim);

const R = 2.42;
const globe = new THREE.Group(); scene.add(globe);
const loader = new THREE.TextureLoader();
const earthMat = new THREE.MeshPhongMaterial({ color:0x9ab0bd, shininess:10 });
loader.load('/assets/earth_atmos_2048.jpg', t=>{ t.colorSpace=THREE.SRGBColorSpace; earthMat.map=t; earthMat.needsUpdate=true; });
loader.load('/assets/earth_normal_2048.jpg', t=>{ earthMat.normalMap=t; earthMat.normalScale.set(.55,.55); earthMat.needsUpdate=true; });
loader.load('/assets/earth_specular_2048.jpg', t=>{ earthMat.specularMap=t; earthMat.specular=new THREE.Color(0x39586b); earthMat.needsUpdate=true; });
const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), earthMat); globe.add(earth);
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R*1.025, 96,64), new THREE.ShaderMaterial({ transparent:true, side:THREE.BackSide, blending:THREE.AdditiveBlending, uniforms:{ glowColor:{value:new THREE.Color(0x3eabdc)} }, vertexShader:`varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader:`varying vec3 vNormal;uniform vec3 glowColor;void main(){float a=pow(.58-dot(vNormal,vec3(0.,0.,1.)),3.2);gl_FragColor=vec4(glowColor,a*.48);}` })); globe.add(atmosphere);
const starGeo = new THREE.BufferGeometry(); const starPos=[]; for(let i=0;i<900;i++){const d=35+Math.random()*35, u=Math.random()*2-1,a=Math.random()*Math.PI*2,r=Math.sqrt(1-u*u);starPos.push(d*r*Math.cos(a),d*u,d*r*Math.sin(a));} starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPos,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0x7895a8,size:.045,transparent:true,opacity:.55,sizeAttenuation:true})));

function geo(lat, lon, radius=R){ const phi=(90-lat)*Math.PI/180, theta=(lon+180)*Math.PI/180; return new THREE.Vector3(-radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta)); }
// Deliberately fictional endpoints: visual narrative, not a geographic targeting tool.
const launchDir=geo(43,-32,1).normalize(), targetDir=geo(36,118,1).normalize(), defenseDir=geo(32,112,1).normalize();
function slerpDir(a,b,t){const dot=THREE.MathUtils.clamp(a.dot(b),-1,1),theta=Math.acos(dot);if(theta<.001)return a.clone();return a.clone().multiplyScalar(Math.sin((1-t)*theta)/Math.sin(theta)).add(b.clone().multiplyScalar(Math.sin(t*theta)/Math.sin(theta))).normalize();}
function flightPoint(t){const dir=slerpDir(launchDir,targetDir,t);const alt=Math.pow(Math.sin(Math.PI*t),.72)*2.15;return dir.multiplyScalar(R+alt);}
function curvePoints(fn,n=240){return Array.from({length:n},(_,i)=>fn(i/(n-1)));}
function line(points,color,opacity=1){return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity,blending:THREE.AdditiveBlending}));}
const trajectoryGroup=new THREE.Group();scene.add(trajectoryGroup);
const path=line(curvePoints(flightPoint),0xff765d,.55);trajectoryGroup.add(path);
const pathGhost=line(curvePoints(t=>flightPoint(t).multiplyScalar(1.006)),0xffb067,.16);trajectoryGroup.add(pathGhost);
const vehicle=new THREE.Mesh(new THREE.SphereGeometry(.055,18,12),new THREE.MeshBasicMaterial({color:0xffd0a0}));vehicle.add(new THREE.PointLight(0xff5b3d,2.5,1.2));scene.add(vehicle);
const vehicleHalo=new THREE.Mesh(new THREE.SphereGeometry(.13,18,12),new THREE.MeshBasicMaterial({color:0xff5f43,transparent:true,opacity:.15,blending:THREE.AdditiveBlending,depthWrite:false}));vehicle.add(vehicleHalo);

const uncertaintyGroup=new THREE.Group();scene.add(uncertaintyGroup);
const uncertaintyRing=new THREE.Mesh(new THREE.RingGeometry(.11,.13,64),new THREE.MeshBasicMaterial({color:0xffb457,transparent:true,opacity:.65,side:THREE.DoubleSide,depthTest:false}));uncertaintyGroup.add(uncertaintyRing);
const estimateDot=new THREE.Mesh(new THREE.SphereGeometry(.028,12,8),new THREE.MeshBasicMaterial({color:0xffc36c,depthTest:false}));uncertaintyGroup.add(estimateDot);

const defenseGroup=new THREE.Group();scene.add(defenseGroup);
function surfaceRing(dir,angularRadius,color){const basis1=new THREE.Vector3().crossVectors(dir,Math.abs(dir.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize(),basis2=new THREE.Vector3().crossVectors(dir,basis1).normalize();const pts=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI*2;pts.push(dir.clone().multiplyScalar(Math.cos(angularRadius)).add(basis1.clone().multiplyScalar(Math.sin(angularRadius)*Math.cos(a))).add(basis2.clone().multiplyScalar(Math.sin(angularRadius)*Math.sin(a))).normalize().multiplyScalar(R*1.006));}return line(pts,color,.45)}
[.13,.24,.36].forEach((a,i)=>defenseGroup.add(surfaceRing(defenseDir,a,i===2?0x58d6e7:0x418ea2)));
const defenseSite=new THREE.Mesh(new THREE.ConeGeometry(.07,.22,6),new THREE.MeshBasicMaterial({color:0x63e4ee}));defenseSite.position.copy(defenseDir.clone().multiplyScalar(R+.1));defenseSite.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),defenseDir);defenseGroup.add(defenseSite);
const interceptT=.89, interceptPoint=flightPoint(interceptT);
function interceptorPoint(t){const a=defenseDir.clone().multiplyScalar(R+.04), b=interceptPoint;const p=a.clone().lerp(b,t);p.add(a.clone().normalize().lerp(b.clone().normalize(),t).normalize().multiplyScalar(Math.sin(Math.PI*t)*.38));return p;}
const interceptPath=line(curvePoints(interceptorPoint,100),0x58d6e7,.48);defenseGroup.add(interceptPath);
const interceptor=new THREE.Mesh(new THREE.SphereGeometry(.042,14,10),new THREE.MeshBasicMaterial({color:0xa8fbff}));interceptor.add(new THREE.PointLight(0x58d6e7,2,1));defenseGroup.add(interceptor);interceptor.visible=false;
const eventBurst=new THREE.Mesh(new THREE.SphereGeometry(.14,24,16),new THREE.MeshBasicMaterial({color:0xffd278,transparent:true,opacity:0,wireframe:true,blending:THREE.AdditiveBlending}));eventBurst.position.copy(interceptPoint);scene.add(eventBurst);

const labelEls=[['launchLabel',launchDir.clone().multiplyScalar(R*1.02)],['targetLabel',targetDir.clone().multiplyScalar(R*1.02)],['defenseLabel',defenseDir.clone().multiplyScalar(R*1.02)]];
function positionLabel(el,p){const v=p.clone().project(camera);const rect=canvas.getBoundingClientRect();const visible=v.z<1&&p.clone().sub(camera.position).dot(p)>-R*R*.2;el.style.display=visible&&state.layers.labels?'block':'none';el.style.left=`${(v.x*.5+.5)*rect.width}px`;el.style.top=`${(-v.y*.5+.5)*rect.height}px`;}

function phaseAt(p){return Math.max(0,phases.findIndex(x=>p>=x.start&&p<x.end));}
function updateUI(){const p=state.progress, idx=phaseAt(p), phase=phases[idx];document.querySelector('#timeline').value=p*1000;document.querySelector('#simClock').textContent=`T+ ${String(Math.floor(p*24)).padStart(2,'0')}:${String(Math.floor((p*1440)%60)).padStart(2,'0')}`;document.querySelectorAll('.phase-item').forEach((el,i)=>{el.classList.toggle('active',i===idx);el.classList.toggle('done',i<idx);});document.querySelector('#phaseMetric').textContent=phase.name;const alt=Math.pow(Math.sin(Math.PI*Math.min(p,.999)),.72);document.querySelector('#altMetric').textContent=alt.toFixed(2);const quality=p<.25?'初始化':p<.58?'间歇':p<.75?'建立':p<.9?'稳定':'收敛';document.querySelector('#trackMetric').textContent=quality;document.querySelector('#windowMetric').textContent=p>.78&&p<.95?'开启':'关闭';
  const drift=.18+.62*Math.sin(Math.PI*Math.min(p/.82,1));document.querySelector('#insState').textContent=p<.08?'对准':p<.7?'漂移增长':'修正';document.querySelector('#insBar').style.width=`${(1-drift*.55)*100}%`;document.querySelector('#extState').textContent=p<.3?'不可用':p<.7?'间歇':'可用';document.querySelector('#extBar').style.width=`${p<.3?12:p<.7?48:82}%`;document.querySelector('#fusionState').textContent=p<.22?'稳定':p<.65?'预测':'收敛';document.querySelector('#fusionBar').style.width=`${62+Math.sin(p*8)*12}%`;document.querySelector('#uncertaintyText').textContent=drift>.62?'较高':drift>.38?'中等':'低';const dot=document.querySelector('#errorDot');dot.style.left=`${25+Math.sin(p*18)*drift*14}px`;dot.style.top=`${25+Math.cos(p*13)*drift*14}px`;
  let chainIndex=p<.57?-1:p<.7?0:p<.78?1:p<.86?2:3;document.querySelectorAll('.chain-item').forEach((el,i)=>{el.classList.toggle('active',i===chainIndex);el.classList.toggle('done',i<chainIndex)});
}
function updateObjects(){const p=state.progress;vehicle.position.copy(flightPoint(Math.min(p,.96)));vehicle.visible=p>=.075&&p<.965;const scale=.7+Math.sin(performance.now()*.006)*.18;vehicleHalo.scale.setScalar(scale);const unc=.12+.22*Math.sin(Math.PI*Math.min(p/.84,1));uncertaintyGroup.position.copy(vehicle.position);uncertaintyRing.scale.setScalar(1+unc*2.2);uncertaintyRing.quaternion.copy(camera.quaternion);estimateDot.position.set(Math.sin(p*18)*unc*.16,Math.cos(p*13)*unc*.13,0);estimateDot.quaternion.copy(camera.quaternion);uncertaintyGroup.visible=state.layers.uncertainty&&vehicle.visible;trajectoryGroup.visible=state.layers.trajectory;defenseGroup.visible=state.layers.defense;
  const it=THREE.MathUtils.clamp((p-.80)/.11,0,1);interceptor.visible=p>.80&&p<.93;interceptor.position.copy(interceptorPoint(it));const burst=Math.max(0,1-Math.abs(p-.91)/.025);eventBurst.material.opacity=burst*.65;eventBurst.scale.setScalar(.7+burst*2.5);
  const reticle=document.querySelector('#reticle');if(p>.58&&p<.93&&state.layers.defense){const v=vehicle.position.clone().project(camera),rect=canvas.getBoundingClientRect();reticle.style.display='block';reticle.style.left=`${(v.x*.5+.5)*rect.width-23}px`;reticle.style.top=`${(-v.y*.5+.5)*rect.height-23}px`;}else reticle.style.display='none';
}
function resize(){const r=canvas.parentElement.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-state.last)/1000,.05);state.last=now;if(state.playing){state.progress+=dt*.028*state.speed;if(state.progress>=1){state.progress=1;state.playing=false;document.querySelector('#playBtn').textContent='▶';}}controls.update();updateObjects();updateUI();labelEls.forEach(([id,p])=>positionLabel(document.querySelector('#'+id),p));renderer.render(scene,camera);}
window.addEventListener('resize',resize);resize();requestAnimationFrame(animate);

document.querySelector('#playBtn').addEventListener('click',e=>{state.playing=!state.playing;if(state.progress>=1)state.progress=0;e.currentTarget.textContent=state.playing?'Ⅱ':'▶';});
document.querySelector('#resetBtn').addEventListener('click',()=>{state.progress=0;state.playing=false;document.querySelector('#playBtn').textContent='▶';});
document.querySelector('#stepBtn').addEventListener('click',()=>{const next=phases.find(x=>x.start>state.progress+.005);state.progress=next?next.start:1;state.playing=false;document.querySelector('#playBtn').textContent='▶';});
document.querySelector('#timeline').addEventListener('input',e=>{state.progress=+e.target.value/1000;state.playing=false;document.querySelector('#playBtn').textContent='▶';});
document.querySelectorAll('[data-speed]').forEach(btn=>btn.addEventListener('click',()=>{state.speed=+btn.dataset.speed;document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',b===btn));}));
document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>state.layers[input.dataset.layer]=input.checked));
document.querySelector('#drawerBtn').addEventListener('click',()=>document.querySelector('#knowledgeDrawer').classList.toggle('open'));
document.querySelectorAll('.phase-item').forEach((el,i)=>el.addEventListener('click',()=>{state.progress=phases[i].start;state.playing=false;}));
