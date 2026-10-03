/**
 * Model-review studio: the car alone on a neutral background with flat,
 * even lighting and an ORTHOGRAPHIC camera, so renders can be compared
 * against reference photos for proportion and placement without the
 * highway sim's road/clouds/particles (which are slow under SwiftShader
 * and clutter the image).
 *
 * Modes (?mode=):
 *   matte  - real materials, flat lights (colour + element placement)
 *   clay   - single matte gray material + black edge outlines (shape)
 *
 * The capture script drives it through window.__studio.setView(name).
 */
import * as THREE from 'three';
import { createCar } from './car.js';

const MODE = new URLSearchParams(location.search).get('mode') || 'matte';
const W = 1280, H = 720, ASPECT = W / H;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa0a6);

// Flat, even lighting: no shadows, no env map dependence.
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(6, 10, 8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.7);
fill.position.set(-8, 5, -6);
scene.add(fill);

const car = createCar();
scene.add(car.group);

// Neutralize env-map-dependent materials so the studio reads shape, not
// reflections: swap the physical paint/glass for plain standards.
if (MODE === 'matte') {
  scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.isMeshPhysicalMaterial) {
      const flat = new THREE.MeshStandardMaterial({
        color: m.color, roughness: 0.55, metalness: 0.0,
        emissive: m.emissive || new THREE.Color(0), emissiveIntensity: m.emissiveIntensity ?? 0,
      });
      o.material = flat;
    }
  });
}

// Clay mode: one gray material everywhere + black edge outlines. The
// outlines make silhouettes, panel breaks and stray geometry obvious to
// a vision model (and to us) without any shading ambiguity.
if (MODE === 'clay') {
  const clay = new THREE.MeshLambertMaterial({ color: 0xd0d4d9 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x101418 });
  const edgeGeos = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.material = clay;
    const eg = new THREE.EdgesGeometry(o.geometry, 24);
    edgeGeos.push(eg);
    const lines = new THREE.LineSegments(eg, edgeMat);
    lines.position.copy(o.position);
    lines.rotation.copy(o.rotation);
    lines.scale.copy(o.scale);
    o.parent.add(lines);
  });
}

// ---- orthographic views -------------------------------------------------
// Car faces +Z; side view from -X (driver's side, matching most refs).
const VIEWS = {
  side:      { pos: [-12, 0.75, 0],   look: [0, 0.75, 0],   d: 2.9 },
  front:     { pos: [0, 0.85, 12],    look: [0, 0.8, 0],    d: 1.6 },
  rear:      { pos: [0, 0.85, -12],   look: [0, 0.8, 0],    d: 1.6 },
  quarter:   { pos: [-8, 2.2, -8],    look: [0, 0.7, 0],    d: 2.4 },
  // zoomed regions for detail work
  greenhouse:{ pos: [-8, 1.6, 0],     look: [0, 1.2, 0],    d: 1.15 },
  fascia:    { pos: [0, 1.0, 8],      look: [0, 0.8, 2.2],  d: 1.1 },
  tail:      { pos: [0, 1.0, -8],     look: [0, 0.8, -2.3], d: 1.1 },
  cowl:      { pos: [-5, 1.6, 4],     look: [0, 1.05, 0.8], d: 0.8 },
};

let camera = null;

function setView(name) {
  const v = VIEWS[name] || VIEWS.side;
  const halfW = v.d * ASPECT;
  camera = new THREE.OrthographicCamera(-halfW, halfW, v.d, -v.d, 0.1, 200);
  camera.position.set(...v.pos);
  camera.lookAt(...v.look);
  camera.updateProjectionMatrix();
  car.update(0, 0);
  renderer.render(scene, camera);
  return name;
}

window.__studio = { setView, views: Object.keys(VIEWS) };
window.__simReady = true;
setView('side');
