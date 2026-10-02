import * as THREE from 'three';
import { SIM, randRange } from './config.js';

/**
 * FX layers, all streaming backward (-Z) to sell high speed:
 *  1. Wind streaks  — LineSegments with per-particle velocity vectors that
 *                     bend around the car's silhouette (airflow feel).
 *  2. Road dust     — InstancedMesh motes kicked up near the wheels.
 *  3. Light trails  — additive streaks in the far periphery.
 *  4. Petals        — InstancedMesh flower petals tumbling past, spun by
 *                     the slipstream.
 *  5. Taillight anime streaks — additive red lines emitted from the light
 *                     clusters, drawn long like speed-line manga FX.
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

// ---------------------------------------------------------------- petals
function makePetalTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // teardrop petal, soft edge, warm pink with a pale core
  const g = ctx.createRadialGradient(size * 0.5, size * 0.62, 2, size * 0.5, size * 0.55, size * 0.45);
  g.addColorStop(0, 'rgba(255,240,242,0.95)');
  g.addColorStop(0.5, 'rgba(255,183,197,0.9)');
  g.addColorStop(1, 'rgba(250,150,170,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.55, size * 0.34, size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildPetals(count) {
  // flat quad petal; double-sided so tumbling always shows a face
  const geo = new THREE.PlaneGeometry(0.09, 0.12);
  const mat = new THREE.MeshBasicMaterial({
    map: makePetalTexture(), transparent: true, side: THREE.DoubleSide,
    depthWrite: false, fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  const data = [];
  for (let i = 0; i < count; i++) {
    // Bias petals into a stream flowing past the car's left/rear side —
    // compositional flow toward the vanishing point, not random scatter.
    const stream = Math.random() < 0.6;
    data.push({
      x: stream ? randRange(-6.5, -1.2) : randRange(-BOX.x, BOX.x),
      y: stream ? randRange(0.3, 2.2) : randRange(0.2, 3.2),
      z: randRange(-BOX.z, BOX.z),
      speedMul: randRange(0.85, 1.25),
      swayAmp: randRange(0.3, 1.1),
      swayFreq: randRange(1.5, 4.0),
      phase: Math.random() * Math.PI * 2,
      spin: randRange(2, 7),
      fall: randRange(0.15, 0.55),
      scale: randRange(0.7, 1.8),
    });
  }
  return { mesh, data };
}

// ---------------------------------------------------------------- anime taillight streaks
function makeStreakTexture() {
  // head (u=0, at the lamp) hot and opaque, tail (u=1) fades out
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,140,110,0.85)');
  g.addColorStop(1, 'rgba(255,60,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Tapered quad: narrow at local x=0 (the lamp), wider at x=1 (the tail).
// Length is per-instance scale.x; width variation is scale.y.
function makeTaperedQuad(narrowW, wideW) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, -narrowW / 2, 0,
    0,  narrowW / 2, 0,
    1, -wideW / 2, 0,
    1,  wideW / 2, 0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 1, 0, 1, 1,
  ]), 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.computeVertexNormals();
  return geo;
}

function buildTailStreaks(anchors) {
  // Each taillight anchor emits tapered red glow trails that start thin
  // at the lamp and widen + fade as they stream backward — the manga
  // speed-line look. Crossed ribbons (vertical + horizontal) so the
  // trail never disappears edge-on from the chase camera.
  const perAnchor = 6;
  const count = anchors.length * perAnchor * 2; // 2 quads/streak
  const geo = makeTaperedQuad(0.05, 0.30);
  const mat = new THREE.MeshBasicMaterial({
    map: makeStreakTexture(),
    transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    color: 0xffffff,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  const data = [];
  for (let a = 0; a < anchors.length; a++) {
    const [ax, ay, az] = anchors[a];
    for (let j = 0; j < perAnchor; j++) {
      data.push({
        ax, ay, az,
        offX: randRange(-0.22, 0.22),
        offY: randRange(-0.14, 0.14),
        t: Math.random(),                 // phase along its lane
        lane: randRange(2, 5),            // head oscillates near the lamp
        speedMul: randRange(1.8, 2.8),
        width: randRange(0.7, 1.5),
      });
      const i = data.length - 1;
      // hot core red with a hint of orange variation (both ribbon quads)
      const warm = randRange(0.0, 0.15);
      const col = new THREE.Color(1.0, 0.10 + warm, 0.05 + warm * 0.5);
      mesh.setColorAt(i * 2, col);
      mesh.setColorAt(i * 2 + 1, col);
    }
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // ribbon orientations (rotation matrices; naive Euler would point the
  // length sideways). Vertical ribbon: length -> world -Z, width -> Y.
  // Flat ribbon: length -> world -Z, width -> X (lies on the road plane).
  const vertQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0)));
  const flatQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, -1, 0)));

  return { mesh, data, vertQuat, flatQuat };
}

// ---------------------------------------------------------------- factory
export function createParticles(taillightAnchors = []) {
  const group = new THREE.Group();
  const wind = buildWind(420);
  const dust = buildDust(140);
  const trails = buildTrails(40);
  const petals = buildPetals(120);
  const anchors = taillightAnchors.length
    ? taillightAnchors
    : [[0.62, 0.87, -2.5], [-0.62, 0.87, -2.5], [0.885, 0.86, -2.3], [-0.885, 0.86, -2.3]];
  const tail = buildTailStreaks(anchors);
  group.add(wind.lines, dust.mesh, trails.lines, petals.mesh, tail.mesh);

  const dummy = new THREE.Object3D();

  function update(dt, t = performance.now() * 0.001) {
    const v = SIM.speedMs;

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
        dummy.rotation.set(0, 0, 0);
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

    // ---- petals: tumble in the slipstream, sway sideways, fall slowly.
    {
      for (let i = 0; i < petals.data.length; i++) {
        const p = petals.data[i];
        p.z -= v * p.speedMul * dt;
        p.y -= p.fall * dt;
        const sway = Math.sin(t * p.swayFreq + p.phase) * p.swayAmp * dt;
        p.x += sway + (Math.abs(p.x) < 1.4 && Math.abs(p.z) < 3 ? Math.sign(p.x || 1) * 0.6 * dt : 0);

        if (p.z < -BOX.z || p.y < 0.02) {
          p.z = randRange(BOX.z * 0.4, BOX.z);
          const stream = Math.random() < 0.6;
          p.y = stream ? randRange(0.3, 2.2) : randRange(0.6, 3.2);
          p.x = stream ? randRange(-6.5, -1.2) : randRange(-BOX.x, BOX.x);
        }

        dummy.position.set(p.x, p.y, p.z);
        // lie the petal roughly flat in the airstream, tumbling around X:
        // reads as flow along the road rather than confetti facing camera
        dummy.rotation.set(
          Math.PI / 2 + Math.sin(t * p.spin + p.phase) * 0.7,
          t * p.spin * 0.4,
          Math.sin(t * p.swayFreq + p.phase) * 1.2);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        petals.mesh.setMatrixAt(i, dummy.matrix);
      }
      petals.mesh.instanceMatrix.needsUpdate = true;
    }

    // ---- anime taillight streaks: tapered trails, thin at the lamp and
    // widening + fading backward; head sits at the lamp, body runs back.
    {
      for (let i = 0; i < tail.data.length; i++) {
        const p = tail.data[i];
        p.t += (v * p.speedMul / p.lane) * dt;
        if (p.t > 1) p.t -= 1;

        const headZ = p.az - p.t * p.lane;
        // Long body running back PAST the chase camera: the visible slice
        // between lamp and camera reads as a red line flying at you.
        const streakLen = 7.0 + v * 0.22;
        dummy.position.set(p.ax + p.offX, p.ay + p.offY, headZ);
        dummy.scale.set(streakLen, p.width, 1);

        dummy.quaternion.copy(tail.vertQuat);
        dummy.updateMatrix();
        tail.mesh.setMatrixAt(i * 2, dummy.matrix);

        dummy.quaternion.copy(tail.flatQuat);
        dummy.updateMatrix();
        tail.mesh.setMatrixAt(i * 2 + 1, dummy.matrix);
      }
      tail.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, update };
}
