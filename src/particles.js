import * as THREE from 'three';
import { SIM, randRange } from './config.js';

/**
 * Three FX layers, all streaming backward (-Z) to sell high speed:
 *  1. Wind streaks  — LineSegments with per-particle velocity vectors that
 *                     bend around the car's silhouette (airflow feel).
 *  2. Road dust     — InstancedMesh motes kicked up near the wheels.
 *  3. Light trails  — additive streaks in the far periphery.
 * Returns { group, update(dt) }.
 */

const BOX = { x: 9, y: 4.5, z: 70 };   // spawn volume (x, y, z-half-extents)

// ---------------------------------------------------------------- wind
function buildWind(count) {
  const positions = new Float32Array(count * 2 * 3); // segment head + tail
  const colors = new Float32Array(count * 2 * 3);
  const data = [];

  for (let i = 0; i < count; i++) {
    data.push({
      x: randRange(-BOX.x, BOX.x),
      y: randRange(0.15, BOX.y),
      z: randRange(-BOX.z, BOX.z),
      len: randRange(1.2, 3.5),
      speedMul: randRange(1.15, 1.9),   // streaks outrun the road = wind
      drift: randRange(-0.3, 0.3),
    });
    const c = randRange(0.55, 0.95);
    for (let v = 0; v < 2; v++) {
      colors[i * 6 + v * 3 + 0] = c;
      colors[i * 6 + v * 3 + 1] = c;
      colors[i * 6 + v * 3 + 2] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.32, fog: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, data, geo };
}

// ---------------------------------------------------------------- dust
function buildDust(count) {
  const geo = new THREE.SphereGeometry(0.02, 5, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9aa08e, transparent: true, opacity: 0.5, fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      x: randRange(-1.6, 1.6),
      y: randRange(0.02, 0.5),
      z: randRange(-30, 25),
      vy: randRange(0.2, 0.9),
      phase: Math.random() * Math.PI * 2,
      scale: randRange(0.5, 1.6),
    });
  }
  return { mesh, data };
}

// ---------------------------------------------------------------- light trails
function buildTrails(count) {
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);
  const data = [];

  const palette = [
    [1.0, 0.25, 0.15],  // tail-red
    [1.0, 0.85, 0.55],  // amber
    [0.85, 0.9, 1.0],   // white
  ];
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    data.push({
      x: side * randRange(6.5, BOX.x),
      y: randRange(0.4, 2.6),
      z: randRange(-BOX.z, BOX.z),
      len: randRange(4, 12),
      speedMul: randRange(1.6, 2.4),
    });
    const [r, g, b] = palette[i % palette.length];
    for (let v = 0; v < 2; v++) {
      colors[i * 6 + v * 3 + 0] = r;
      colors[i * 6 + v * 3 + 1] = g;
      colors[i * 6 + v * 3 + 2] = b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, data, geo };
}

// ---------------------------------------------------------------- factory
export function createParticles() {
  const group = new THREE.Group();
  const wind = buildWind(260);
  const dust = buildDust(140);
  const trails = buildTrails(40);
  group.add(wind.lines, dust.mesh, trails.lines);

  const dummy = new THREE.Object3D();

  function update(dt) {
    const v = SIM.speedMs;
    const t = performance.now() * 0.001;

    // ---- wind streaks: velocity vector = -Z flow + lateral drift that
    // bends outward when passing the car body (pressure field feel).
    {
      const pos = wind.geo.attributes.position.array;
      for (let i = 0; i < wind.data.length; i++) {
        const p = wind.data[i];
        const dz = v * p.speedMul * dt;
        p.z -= dz;

        // deflection around the car silhouette
        let lateral = p.drift * dt;
        if (Math.abs(p.z) < 3.2 && Math.abs(p.x) < 1.6 && p.y < 1.7) {
          lateral += Math.sign(p.x || 1) * 0.9 * dt;
        }
        p.x += lateral;

        if (p.z < -BOX.z) {
          p.z += BOX.z * 2;
          p.x = randRange(-BOX.x, BOX.x);
          p.y = randRange(0.15, BOX.y);
        }

        // streak length scales with speed -> longer at 130 than 110 km/h
        const len = p.len * (0.6 + v / 40);
        const i6 = i * 6;
        pos[i6 + 0] = p.x;         pos[i6 + 1] = p.y;         pos[i6 + 2] = p.z;
        pos[i6 + 3] = p.x - p.drift * 0.15;
        pos[i6 + 4] = p.y;
        pos[i6 + 5] = p.z + len;
      }
      wind.geo.attributes.position.needsUpdate = true;
    }

    // ---- road dust: rises near the wheels, swirls, wraps.
    {
      for (let i = 0; i < dust.data.length; i++) {
        const p = dust.data[i];
        p.z -= v * dt * 1.05;
        p.y += p.vy * dt;
        p.x += Math.sin(t * 3 + p.phase) * 0.15 * dt;
        if (p.y > 1.4 || p.z < -30) {
          p.y = randRange(0.02, 0.15);
          p.z = randRange(-2.5, 2.0);           // respawn near wheels
          p.x = randRange(-1.6, 1.6);
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        dust.mesh.setMatrixAt(i, dummy.matrix);
      }
      dust.mesh.instanceMatrix.needsUpdate = true;
    }

    // ---- light trails: fast additive streaks in the periphery.
    {
      const pos = trails.geo.attributes.position.array;
      for (let i = 0; i < trails.data.length; i++) {
        const p = trails.data[i];
        p.z -= v * p.speedMul * dt;
        if (p.z < -BOX.z) {
          p.z += BOX.z * 2;
          p.x = (Math.random() < 0.5 ? 1 : -1) * randRange(6.5, BOX.x);
          p.y = randRange(0.4, 2.6);
        }
        const len = p.len * (0.6 + v / 40);
        const i6 = i * 6;
        pos[i6 + 0] = p.x; pos[i6 + 1] = p.y; pos[i6 + 2] = p.z;
        pos[i6 + 3] = p.x; pos[i6 + 4] = p.y; pos[i6 + 5] = p.z + len;
      }
      trails.geo.attributes.position.needsUpdate = true;
    }
  }

  return { group, update };
}
