import * as THREE from 'three';
import { SIM } from './config.js';

/**
 * Procedural composite model of a silver 2004 Honda Accord sedan (7th gen,
 * NA spec), built to reference measurements:
 *   length 4.85 m, wheelbase 2.74 m, width 1.81 m, height 1.45 m,
 *   front overhang 0.89 m, rear overhang 1.22 m, beltline 0.97 m,
 *   tire diameter ~0.66 m.
 * Car faces +Z. Returns { group, update(dt, t) } — update spins wheels
 * and drives subtle body roll / suspension heave.
 */

const WHEEL_RADIUS = 0.33;
const WB_HALF = 1.37;             // half wheelbase
const FRONT_Z = WB_HALF + 0.89;   // 2.26 nose
const REAR_Z = -(WB_HALF + 1.22); // -2.59 tail

// ---------------------------------------------------------------- materials
function makePaint() {
  // Honda NH-623M "Satin Silver Metallic" — cool neutral silver, ~#C0C0C0.
  return new THREE.MeshPhysicalMaterial({
    color: 0xbfc3c6,
    metalness: 0.85,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.5,
  });
}

const MAT = {
  paint: makePaint(),
  bumperPaint: new THREE.MeshPhysicalMaterial({
    color: 0xbcc0c4, metalness: 0.7, roughness: 0.3, clearcoat: 0.7,
  }),
  darkTrim: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.2 }),
  meshIntake: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.85, metalness: 0.1 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x10161c, metalness: 0.55, roughness: 0.08,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.6,
  }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0xf5f2e8, roughness: 0.15, metalness: 0.1,
    emissive: 0xfff3d0, emissiveIntensity: 0.9,
  }),
  amber: new THREE.MeshStandardMaterial({
    color: 0xd86a10, roughness: 0.3, emissive: 0xff8c1a, emissiveIntensity: 0.5,
  }),
  taillight: new THREE.MeshStandardMaterial({
    color: 0x8a1408, roughness: 0.25, metalness: 0.1,
    emissive: 0xff2a12, emissiveIntensity: 1.3,
  }),
  reverseLens: new THREE.MeshStandardMaterial({
    color: 0xd8d8d0, roughness: 0.3, emissive: 0xfff8e8, emissiveIntensity: 0.25,
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
  geo.rotateY(-Math.PI / 2); // extrusion (shape +Z) -> world -X
  // Extrusion runs 0..-depth after rotation; recenter on X so the body
  // spans [-halfWidth, +halfWidth] and both wheel sides are symmetric.
  geo.translate(halfWidth - bevel, 0, 0);
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
// `side` = +1 for right wheels, -1 for left: the rim face must point
// OUTBOARD (away from the body), otherwise spokes hide inside the tire.
function makeWheel(side) {
  const wheel = new THREE.Group();

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 32),
    MAT.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);

  // Factory 5-spoke alloy — broad blade spokes, flush with the outboard
  // tire face so the rim is actually visible.
  const rim = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.28, 16), MAT.rim);
  hub.rotation.z = Math.PI / 2;
  rim.add(hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.09), MAT.rim);
    spoke.position.set(side * 0.105, 0.14, 0);
    const arm = new THREE.Group();
    arm.add(spoke);
    arm.rotation.x = (i / 5) * Math.PI * 2;
    rim.add(arm);
  }
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(0.255, 0.03, 8, 28), MAT.rim);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = side * 0.115;
  rim.add(lip);
  wheel.add(rim);

  return wheel;
}

// ---------------------------------------------------------------- build
export function createCar() {
  const group = new THREE.Group();
  const body = new THREE.Group();   // everything except wheels (sprung mass)
  group.add(body);

  // ---- lower body: notchback silhouette, long trunk, short nose.
  // profileX = -z. Hood nearly flat with gentle rise to cowl, cowl step,
  // high beltline, flat decklid with a small lip kick at the tail.
  const lowerProfile = [
    [-2.26, 0.42], [-2.24, 0.62], [-2.22, 0.86],   // nose / bumper face
    [-2.20, 0.92], [-1.60, 0.96], [-1.02, 1.00],   // hood, gentle rise
    [-0.98, 0.95],                                 // cowl step down
    [1.30, 0.96],                                  // beltline under glass
    [2.30, 0.98], [2.42, 1.02],                    // decklid + lip kick
    [2.55, 0.95], [2.58, 0.60], [2.55, 0.42],      // tail
    [2.50, 0.30], [-2.20, 0.30],                   // underside
  ];
  const lower = new THREE.Mesh(extrudeProfile(lowerProfile, 0.90, 0.12), MAT.paint);
  lower.castShadow = true;
  body.add(lower);

  // ---- greenhouse: raked windshield (~36 deg), low broad roof, raked
  // rear glass, thick C-pillar feel. Tall airy cabin per reference.
  const glassProfile = [
    [-0.95, 0.97], [-0.62, 1.42], [0.35, 1.45], [0.70, 1.43], [1.15, 0.99],
  ];
  const greenhouse = new THREE.Mesh(extrudeProfile(glassProfile, 0.76, 0.06, 4), MAT.glass);
  greenhouse.castShadow = true;
  body.add(greenhouse);

  // ---- sunroof: dark flush panel on the roof
  body.add(box(0.72, 0.02, 0.62, MAT.darkTrim, 0, 1.452, -0.15));

  // ---- bumpers (body-colour, smoothly rounded per reference)
  body.add(box(1.68, 0.34, 0.18, MAT.bumperPaint, 0, 0.55, FRONT_Z - 0.02));
  body.add(box(1.68, 0.36, 0.16, MAT.bumperPaint, 0, 0.55, REAR_Z + 0.02));

  // ---- front fascia: SMALL narrow 2-bar grille + wide low mesh intake
  body.add(box(0.62, 0.10, 0.05, MAT.meshIntake, 0, 0.85, FRONT_Z - 0.01));
  body.add(box(0.62, 0.02, 0.06, MAT.chrome, 0, 0.85, FRONT_Z));         // chrome bar
  body.add(box(0.66, 0.02, 0.05, MAT.chrome, 0, 0.90, FRONT_Z - 0.005)); // chrome surround top
  body.add(box(1.30, 0.13, 0.05, MAT.meshIntake, 0, 0.47, FRONT_Z - 0.01)); // lower air dam
  // fog lamp recesses in the bumper corners
  body.add(box(0.16, 0.09, 0.04, MAT.meshIntake, 0.66, 0.47, FRONT_Z));
  body.add(box(0.16, 0.09, 0.04, MAT.meshIntake, -0.66, 0.47, FRONT_Z));

  // ---- headlights: large swept wrap-around clear units + amber corner
  for (const s of [1, -1]) {
    body.add(box(0.46, 0.17, 0.05, MAT.headlight, s * 0.60, 0.84, FRONT_Z - 0.02)); // front face
    body.add(box(0.05, 0.14, 0.40, MAT.headlight, s * 0.885, 0.83, 1.94));          // fender wrap
    body.add(box(0.05, 0.09, 0.14, MAT.amber, s * 0.89, 0.80, 1.72));               // amber reflector
  }

  // ---- taillights: horizontal red wedge wrapping the corner + clear reverse section
  for (const s of [1, -1]) {
    body.add(box(0.40, 0.15, 0.05, MAT.taillight, s * 0.62, 0.87, REAR_Z + 0.01));
    body.add(box(0.05, 0.13, 0.44, MAT.taillight, s * 0.885, 0.86, -2.30));
    body.add(box(0.12, 0.10, 0.05, MAT.reverseLens, s * 0.34, 0.85, REAR_Z + 0.012));
  }

  // ---- chrome beltline molding (window base) + door protective molding
  for (const s of [1, -1]) {
    body.add(box(0.02, 0.025, 2.05, MAT.chrome, s * 0.905, 0.975, -0.10));
    body.add(box(0.02, 0.035, 1.90, MAT.chrome, s * 0.91, 0.72, -0.05));
  }

  // ---- side mirrors: teardrop housing + small amber indicator
  for (const s of [1, -1]) {
    body.add(box(0.05, 0.04, 0.10, MAT.darkTrim, s * 0.94, 1.02, 0.92));
    body.add(box(0.10, 0.12, 0.16, MAT.paint, s * 1.02, 1.06, 0.84));
    body.add(box(0.02, 0.04, 0.06, MAT.amber, s * 1.075, 1.05, 0.90));
  }

  // ---- door handles (body-colour pull-type, on the shoulder line)
  for (const s of [1, -1]) {
    body.add(box(0.03, 0.03, 0.16, MAT.paint, s * 0.915, 0.93, 0.28));
    body.add(box(0.03, 0.03, 0.16, MAT.paint, s * 0.915, 0.93, -0.46));
  }

  // ---- fuel filler door (left rear quarter)
  const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), MAT.paint);
  filler.rotation.z = Math.PI / 2;
  filler.position.set(-0.905, 0.85, -1.55);
  body.add(filler);

  // ---- exhaust tip
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), MAT.chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.34, REAR_Z - 0.02);
  body.add(exhaust);

  // ---- license plates
  body.add(box(0.36, 0.11, 0.02, new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }), 0, 0.62, REAR_Z - 0.01));
  body.add(box(0.36, 0.11, 0.02, new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }), 0, 0.55, FRONT_Z + 0.01));

  // ---- contact shadow: soft dark blob hugging the sills so the car
  // reads as planted even when the sun cast shadow falls elsewhere.
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 128;
  const bctx = blobCanvas.getContext('2d');
  const grad = bctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.30)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  bctx.fillStyle = grad;
  bctx.fillRect(0, 0, 128, 128);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 5.4),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(blobCanvas),
      transparent: true, depthWrite: false,
    }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  group.add(contact);

  // ---- wheels (unsprung — stay planted while the body heaves).
  // x=0.86 puts the outer tire face at 0.98, ~8cm OUTSIDE the body side
  // (0.90): coplanar faces here caused z-fighting along the arches.
  const wheels = [];
  const wheelPos = [
    [0.86, WHEEL_RADIUS, WB_HALF, 1], [-0.86, WHEEL_RADIUS, WB_HALF, -1],
    [0.86, WHEEL_RADIUS, -WB_HALF, 1], [-0.86, WHEEL_RADIUS, -WB_HALF, -1],
  ];
  for (const [x, y, z, side] of wheelPos) {
    const w = makeWheel(side);
    w.position.set(x, y, z);
    group.add(w);
    wheels.push(w);
  }

  // Taillight world positions for the anime streak emitter.
  const taillightAnchors = [
    [0.62, 0.87, REAR_Z], [-0.62, 0.87, REAR_Z],
    [0.885, 0.86, -2.30], [-0.885, 0.86, -2.30],
  ];

  // ---------------------------------------------------------------- update
  function update(dt, t) {
    // Wheel spin: v = omega * r. Forward (+Z) means the tire top travels
    // +Z relative to the axle -> rotation.x INCREASES (right-hand rule).
    const spin = (SIM.speedMs / WHEEL_RADIUS) * dt;
    for (const w of wheels) w.rotation.x += spin;

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

  return { group, update, taillightAnchors };
}
