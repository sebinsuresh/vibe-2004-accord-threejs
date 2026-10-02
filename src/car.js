import * as THREE from 'three';
import { SIM } from './config.js';

/**
 * Procedural composite model of a silver 2004 Honda Accord sedan.
 * Car faces +Z. Overall: 4.7 m long, 1.8 m wide, ~1.45 m tall.
 * Returns { group, update(dt, t) } — update spins wheels and drives
 * subtle body roll / suspension heave.
 */

const WHEEL_RADIUS = 0.34;

// ---------------------------------------------------------------- materials
function makePaint() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc8ccd2,          // silver
    metalness: 0.85,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.4,
  });
}

const MAT = {
  paint: makePaint(),
  darkTrim: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.2 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x10161c, metalness: 0.55, roughness: 0.08,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.6,
  }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0xf5f2e8, roughness: 0.15, metalness: 0.1,
    emissive: 0xfff3d0, emissiveIntensity: 0.9,
  }),
  taillight: new THREE.MeshStandardMaterial({
    color: 0x8a1408, roughness: 0.25, metalness: 0.1,
    emissive: 0xff2a12, emissiveIntensity: 1.3,
  }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1.0, roughness: 0.12 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9, metalness: 0.0 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.95, roughness: 0.25 }),
};

// ---------------------------------------------------------------- helpers
/**
 * Extrude a side-profile polygon (profileX = -worldZ, profileY = worldY)
 * across the car width, then round the edges with a bevel.
 */
function extrudeProfile(points, halfWidth, bevel, bevelSegments = 3) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: (halfWidth - bevel) * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments: 6,
  });
  geo.rotateY(-Math.PI / 2); // extrusion (shape +Z) -> world +X (width)
  geo.computeVertexNormals();
  return geo;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- wheels
function makeWheel() {
  const wheel = new THREE.Group();

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 28),
    MAT.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);

  // 5-spoke alloy (2004 Accord EX style)
  const rim = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 16), MAT.rim);
  hub.rotation.z = Math.PI / 2;
  rim.add(hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.07), MAT.rim);
    spoke.position.y = 0.14;
    const arm = new THREE.Group();
    arm.add(spoke);
    arm.rotation.x = (i / 5) * Math.PI * 2;
    rim.add(arm);
  }
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.025, 8, 28), MAT.rim);
  lip.rotation.y = Math.PI / 2;
  rim.add(lip);
  wheel.add(rim);

  return wheel;
}

// ---------------------------------------------------------------- build
export function createCar() {
  const group = new THREE.Group();
  const body = new THREE.Group();   // everything except wheels (sprung mass)
  group.add(body);

  // ---- lower body: front bumper -> hood -> beltline -> trunk
  const lowerProfile = [
    [2.35, 0.42], [2.42, 0.62], [2.40, 0.86], [2.20, 0.95], // nose / bumper face
    [1.70, 1.00], [1.05, 1.06],                            // hood (slight rise)
    [0.95, 0.98],                                          // cowl step
    [-1.05, 0.98],                                         // beltline under glass
    [-1.95, 1.00],                                         // deck lid
    [-2.30, 0.92], [-2.40, 0.60], [-2.35, 0.42],           // tail
    [-2.30, 0.30], [2.30, 0.30],                          // underside
  ];
  const lower = new THREE.Mesh(extrudeProfile(lowerProfile, 0.90, 0.12), MAT.paint);
  lower.castShadow = true;
  body.add(lower);

  // ---- greenhouse: windshield / roof / rear glass (tinted, reflective)
  const glassProfile = [
    [0.92, 1.00], [0.42, 1.44], [-0.62, 1.46], [-1.32, 1.00],
  ];
  const greenhouse = new THREE.Mesh(extrudeProfile(glassProfile, 0.78, 0.07, 4), MAT.glass);
  greenhouse.castShadow = true;
  body.add(greenhouse);

  // ---- bumpers (slightly satin silver)
  const bumperMat = new THREE.MeshPhysicalMaterial({
    color: 0xb9bec6, metalness: 0.6, roughness: 0.35, clearcoat: 0.6,
  });
  body.add(box(1.66, 0.30, 0.16, bumperMat, 0, 0.52, 2.34));   // front
  body.add(box(1.66, 0.32, 0.14, bumperMat, 0, 0.52, -2.32));  // rear

  // ---- grille + lower intake
  body.add(box(0.9, 0.10, 0.06, MAT.darkTrim, 0, 0.80, 2.36));
  body.add(box(0.9, 0.03, 0.07, MAT.chrome, 0, 0.80, 2.38));   // chrome bar
  body.add(box(1.1, 0.12, 0.06, MAT.darkTrim, 0, 0.44, 2.36));

  // ---- light clusters
  body.add(box(0.42, 0.22, 0.06, MAT.headlight, 0.62, 0.74, 2.33));
  body.add(box(0.42, 0.22, 0.06, MAT.headlight, -0.62, 0.74, 2.33));
  body.add(box(0.36, 0.26, 0.06, MAT.taillight, 0.64, 0.80, -2.36));
  body.add(box(0.36, 0.26, 0.06, MAT.taillight, -0.64, 0.80, -2.36));

  // ---- side mirrors
  for (const s of [1, -1]) {
    body.add(box(0.05, 0.04, 0.10, MAT.darkTrim, s * 0.94, 1.02, 0.92));
    body.add(box(0.10, 0.11, 0.14, MAT.paint, s * 1.02, 1.06, 0.84));
  }

  // ---- door handles
  for (const s of [1, -1]) {
    body.add(box(0.03, 0.03, 0.16, MAT.chrome, s * 0.915, 0.94, 0.30));
    body.add(box(0.03, 0.03, 0.16, MAT.chrome, s * 0.915, 0.94, -0.42));
  }

  // ---- exhaust tip
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), MAT.chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.34, -2.38);
  body.add(exhaust);

  // ---- license plates
  body.add(box(0.36, 0.11, 0.02, new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }), 0, 0.60, -2.40));
  body.add(box(0.36, 0.11, 0.02, new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }), 0, 0.55, 2.40));

  // ---- wheels (unsprung — stay planted while the body heaves)
  const wheels = [];
  const wheelPos = [
    [0.82, WHEEL_RADIUS, 1.45], [-0.82, WHEEL_RADIUS, 1.45],
    [0.82, WHEEL_RADIUS, -1.45], [-0.82, WHEEL_RADIUS, -1.45],
  ];
  for (const [x, y, z] of wheelPos) {
    const w = makeWheel();
    w.position.set(x, y, z);
    group.add(w);
    wheels.push(w);
  }

  // ---------------------------------------------------------------- update
  function update(dt, t) {
    // Wheel spin: v = omega * r, forward (+Z) => spin about -X.
    const spin = (SIM.speedMs / WHEEL_RADIUS) * dt;
    for (const w of wheels) w.rotation.x -= spin;

    // Subtle suspension heave + body roll + pitch under the speed wobble.
    const heave = Math.sin(t * 6.1) * 0.006 + Math.sin(t * 2.3) * 0.004;
    const roll = Math.sin(t * 1.7) * 0.008 + Math.sin(t * 4.9) * 0.002;
    const pitch = Math.sin(t * 0.7) * -0.003;

    body.position.y = heave;
    body.rotation.z = roll;
    body.rotation.x = pitch;

    // Wheels follow the body slightly (suspension travel), out of phase.
    for (const w of wheels) w.position.y = WHEEL_RADIUS + heave * 0.45;
  }

  return { group, update };
}
