import * as THREE from 'three';
import { SIM } from './config.js';

/**
 * Highway environment: scrolling asphalt with painted lane markings,
 * shoulders, guardrails and light poles that physically rush backward,
 * and a wide ground plane. Fog is configured in main.js.
 * Returns { group, update(dt) }.
 */

const ROAD_HALF = 6.0;      // half-width of asphalt
const SEG = 40;             // repeating length of road texture tiles
const POLE_SPACING = 24;    // meters between light poles
const POLE_COUNT = 12;

// ---------------------------------------------------------------- textures
function makeAsphaltTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#33363a';
  ctx.fillRect(0, 0, size, size);

  // speckled aggregate
  for (let i = 0; i < 9000; i++) {
    const g = 40 + Math.random() * 70;
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  // faint tire-wear bands
  ctx.fillStyle = 'rgba(20,20,22,0.18)';
  ctx.fillRect(size * 0.18, 0, size * 0.14, size);
  ctx.fillRect(size * 0.68, 0, size * 0.14, size);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, SEG / 4);
  tex.anisotropy = 8;
  return tex;
}

function makeLaneTexture() {
  // Transparent overlay carrying dashed lane lines + solid edge lines.
  const w = 256, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // solid edge lines
  ctx.fillStyle = 'rgba(235,235,225,0.9)';
  ctx.fillRect(10, 0, 7, h);
  ctx.fillRect(w - 17, 0, 7, h);

  // dashed center lines (2 dashes per tile)
  for (const x of [w * 0.375 - 3, w * 0.625 - 3]) {
    ctx.fillRect(x, h * 0.05, 6, h * 0.30);
    ctx.fillRect(x, h * 0.55, 6, h * 0.30);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, SEG / 8);
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- build
export function createEnvironment() {
  const group = new THREE.Group();

  // ---- ground (dirt/grass tone, catches shadow softly)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x4a4f42, roughness: 1.0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- asphalt
  const asphaltTex = makeAsphaltTexture();
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 600),
    new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0.05 }));
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  group.add(road);

  // ---- lane markings (transparent overlay, scrolls via UV offset)
  const laneTex = makeLaneTexture();
  const lanes = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 600),
    new THREE.MeshStandardMaterial({
      map: laneTex, transparent: true, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
  lanes.rotation.x = -Math.PI / 2;
  lanes.position.y = 0.005;
  group.add(lanes);

  // ---- shoulders
  const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x5a5d60, roughness: 0.95 });
  for (const s of [1, -1]) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 600), shoulderMat);
    sh.position.set(s * (ROAD_HALF + 0.6), 0.04, 0);
    sh.receiveShadow = true;
    group.add(sh);
  }

  // ---- guardrails (physical props that stream past)
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 });
  const posts = [];
  for (const s of [1, -1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 600), railMat);
    beam.position.set(s * (ROAD_HALF + 2.2), 0.65, 0);
    group.add(beam);
    for (let i = 0; i < 60; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), railMat);
      post.position.set(s * (ROAD_HALF + 2.2), 0.35, -300 + i * 10);
      posts.push(post);
    }
  }

  // ---- light poles on the right shoulder
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, metalness: 0.7, roughness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff6dd, emissive: 0xffe9b8, emissiveIntensity: 0.7, roughness: 0.4 });
  const poles = [];
  for (let i = 0; i < POLE_COUNT; i++) {
    const pole = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7, 10), poleMat);
    mast.position.y = 3.5;
    pole.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.09, 0.09), poleMat);
    arm.position.set(-0.8, 6.9, 0);
    pole.add(arm);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.3), lampMat);
    lamp.position.set(-1.5, 6.82, 0);
    pole.add(lamp);
    pole.position.set(ROAD_HALF + 3.4, 0, -POLE_COUNT * POLE_SPACING / 2 + i * POLE_SPACING);
    group.add(pole);
    poles.push(pole);
  }

  // ---------------------------------------------------------------- update
  const wrap = 600;
  function update(dt) {
    const v = SIM.speedMs * dt;

    // Shader-style UV scroll on the road surfaces.
    asphaltTex.offset.y -= v / 4;
    laneTex.offset.y -= v / 8;

    // Physical props stream backward (-Z) and wrap around.
    for (const p of poles) {
      p.position.z -= v;
      if (p.position.z < -wrap / 2) p.position.z += wrap;
    }
    for (const p of posts) {
      p.position.z -= v;
      if (p.position.z < -wrap / 2) p.position.z += wrap;
    }
  }

  return { group, update };
}
