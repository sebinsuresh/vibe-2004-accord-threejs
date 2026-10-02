import * as THREE from 'three';
import { SIM, randRange } from './config.js';

/**
 * Cumulonimbus cloud field: billboard sprites built from a procedurally
 * puffed canvas texture (multiple overlapping radial blobs = cauliflower
 * tops), layered in depth clusters that drift slowly backward with the
 * world and wrap. Sunlit tops via a vertical gradient baked into the puff.
 * Returns { group, update(dt) }.
 */

const CLOUD_COUNT = 26;
const SPREAD = { x: 320, z: 420 };

function makePuffTexture(seed) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // deterministic pseudo-random from seed
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  // cauliflower stack: bigger blobs low-center, smaller puffs on top
  const blobs = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    blobs.push({
      x: size * (0.5 + (rnd() - 0.5) * (0.75 - t * 0.45)),
      y: size * (0.72 - t * 0.5 + (rnd() - 0.5) * 0.12),
      r: size * (0.20 + rnd() * 0.14) * (1.15 - t * 0.55),
    });
  }

  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.25, b.r * 0.1, b.x, b.y, b.r);
    // sunlit upper-left, shaded base
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(238,242,247,0.75)');
    g.addColorStop(1, 'rgba(205,214,224,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // shade the underside (cumulonimbus anvil base is dark)
  const shade = ctx.createLinearGradient(0, size * 0.55, 0, size * 0.9);
  shade.addColorStop(0, 'rgba(120,130,145,0)');
  shade.addColorStop(1, 'rgba(95,105,120,0.35)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createClouds() {
  const group = new THREE.Group();
  const clouds = [];

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const tex = makePuffTexture(i * 7919 + 13);
    const scale = randRange(38, 90);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      opacity: randRange(0.6, 0.92), fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale * randRange(0.62, 0.8), 1);
    // Place clouds in the visible sky band: ahead of the car (the chase
    // cam looks forward), at 3-12 deg elevation so they sit above the
    // horizon but inside the camera frustum.
    const dist = randRange(120, 360);
    const elev = THREE.MathUtils.degToRad(randRange(1, 8));
    sprite.position.set(
      randRange(-0.9, 0.9) * dist,
      2 + dist * Math.tan(elev),
      randRange(0.25, 1) * dist);
    sprite.renderOrder = -1;
    group.add(sprite);
    clouds.push({ sprite, drift: randRange(0.4, 1.4), dist });
  }

  function update(dt) {
    // Clouds stream past far slower than the road (parallax distance),
    // plus their own slow atmospheric drift. Wrap ahead of the car.
    const v = SIM.speedMs * 0.045;
    for (const c of clouds) {
      c.sprite.position.z -= (v + c.drift) * dt;
      if (c.sprite.position.z < 40) {
        const dist = randRange(120, 360);
        const elev = THREE.MathUtils.degToRad(randRange(1, 8));
        c.sprite.position.z = randRange(0.25, 1) * dist;
        c.sprite.position.x = randRange(-0.9, 0.9) * dist;
        c.sprite.position.y = 2 + dist * Math.tan(elev);
      }
    }
  }

  return { group, update };
}
