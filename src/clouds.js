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

  // cumulus structure: dense flat-ish base row, puffy tower above,
  // smaller anvil wisps at top. Crisper blobs (less falloff) so it
  // reads as a cloud body, not smoke.
  const blobs = [];
  for (let i = 0; i < 7; i++) {           // base row
    blobs.push({ x: size * (0.18 + i * 0.11 + (rnd() - 0.5) * 0.06),
                 y: size * (0.66 + (rnd() - 0.5) * 0.08),
                 r: size * (0.13 + rnd() * 0.05) });
  }
  for (let i = 0; i < 6; i++) {           // tower puffs
    const t = i / 6;
    blobs.push({ x: size * (0.35 + rnd() * 0.3 + (rnd() - 0.5) * 0.1),
                 y: size * (0.52 - t * 0.3 + (rnd() - 0.5) * 0.07),
                 r: size * (0.15 + rnd() * 0.07) * (1.1 - t * 0.4) });
  }
  for (let i = 0; i < 3; i++) {           // anvil wisps
    blobs.push({ x: size * (0.3 + rnd() * 0.4),
                 y: size * (0.16 + rnd() * 0.06),
                 r: size * (0.07 + rnd() * 0.04) });
  }

  // build silhouette first (opaque white), then light it
  ctx.fillStyle = '#ffffff';
  for (const b of blobs) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // soften only the outer edge: blur-copy the silhouette slightly
  ctx.filter = 'blur(3px)';
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';

  // golden-hour lighting: warm sun from the left lights the left/top
  // faces; the right/underside falls into cool blue shadow.
  ctx.globalCompositeOperation = 'source-atop';
  const sunSide = ctx.createLinearGradient(0, size * 0.2, size, size * 0.8);
  sunSide.addColorStop(0, 'rgba(255,214,170,0.85)');   // warm lit edge
  sunSide.addColorStop(0.45, 'rgba(250,244,238,0.55)');
  sunSide.addColorStop(1, 'rgba(96,110,140,0.75)');    // cool shadow side
  ctx.fillStyle = sunSide;
  ctx.fillRect(0, 0, size, size);
  // darker cloud base (underside)
  const base = ctx.createLinearGradient(0, size * 0.5, 0, size * 0.85);
  base.addColorStop(0, 'rgba(70,84,110,0)');
  base.addColorStop(1, 'rgba(70,84,110,0.55)');
  ctx.fillStyle = base;
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
    // cam looks forward), and LIFTED so the sprite's bottom edge stays
    // above the horizon — otherwise low clouds paint over the road.
    const dist = randRange(120, 360);
    const elev = THREE.MathUtils.degToRad(randRange(2, 9));
    const halfH = sprite.scale.y / 2;
    const horizonY = 2 + dist * Math.tan(THREE.MathUtils.degToRad(1.5));
    sprite.position.set(
      randRange(-0.9, 0.9) * dist,
      Math.max(horizonY, dist * Math.tan(elev)) + halfH,
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
        const elev = THREE.MathUtils.degToRad(randRange(2, 9));
        const halfH = c.sprite.scale.y / 2;
        const horizonY = 2 + dist * Math.tan(THREE.MathUtils.degToRad(1.5));
        c.sprite.position.z = randRange(0.25, 1) * dist;
        c.sprite.position.x = randRange(-0.9, 0.9) * dist;
        c.sprite.position.y =
          Math.max(horizonY, dist * Math.tan(elev)) + halfH;
      }
    }
  }

  return { group, update };
}
