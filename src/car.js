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
const FRONT_Z = 2.31;             // nose (front overhang 0.94)
const REAR_Z = -2.48;             // tail (rear overhang 1.11)

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

  // ---- lower body: notchback silhouette, LONG hood (cowl ~0.8 m behind
  // the front axle, like the real CL7), moderate cabin, long trunk.
  // profileX = -z. Hood nearly flat with gentle rise to cowl, cowl step,
  // high beltline, flat decklid with a small lip kick at the tail.
  const lowerProfile = [
    [-2.31, 0.42], [-2.29, 0.62], [-2.27, 0.86],   // nose / bumper face
    [-2.25, 0.92], [-1.60, 0.96], [-0.55, 1.00],   // long hood, gentle rise
    [-0.50, 0.95],                                 // cowl step down
    [1.20, 0.96],                                  // beltline under glass
    [2.20, 0.98], [2.32, 1.02],                    // decklid + lip kick
    [2.45, 0.95], [2.48, 0.60], [2.45, 0.42],      // tail
    [2.40, 0.30], [-2.25, 0.30],                   // underside
  ];
  const lower = new THREE.Mesh(extrudeProfile(lowerProfile, 0.90, 0.16), MAT.paint);
  lower.castShadow = true;
  body.add(lower);

  // ---- greenhouse: ONE body-colour shell (roof + pillars + C-pillar
  // mass) extruded from the beltline up, with dark glass panels inset
  // into its faces. This is how the real car is built (painted shell +
  // windows) and it removes the floating-slab/strut artifacts the old
  // glass-slab + stuck-on-pillar approach produced.
  // profileX = -worldZ; car faces +Z.
  const upperProfile = [
    [-0.50, 0.96],   // cowl / windshield base
    [0.00, 1.42],    // windshield top
    [1.30, 1.40],    // roof rear edge
    [1.70, 0.96],    // rear glass base at decklid
  ];
  const upper = new THREE.Mesh(extrudeProfile(upperProfile, 0.86, 0.10, 4), MAT.paint);
  upper.castShadow = true;
  body.add(upper);

  // ---- glass panels inset into the shell faces (x = +-0.865 sits just
  // outside the 0.86 shell surface so the panel reads as flush glass).
  // Rectangle edges must stay INSIDE the sloped A/C-pillar faces: at the
  // window top (y 1.37) the windshield face is at z 0.05 and the rear
  // glass face at z -1.33; at the bottom (y 1.03) z 0.42 / -1.64.
  for (const s of [1, -1]) {
    body.add(box(0.02, 0.34, 0.58, MAT.glass, s * 0.865, 1.20, -0.29));   // front door window (z 0.00..-0.58)
    body.add(box(0.02, 0.34, 0.52, MAT.glass, s * 0.865, 1.20, -0.94));   // rear door window (z -0.68..-1.20)
    body.add(box(0.02, 0.24, 0.12, MAT.glass, s * 0.865, 1.13, -1.37));   // quarter glass (z -1.31..-1.43)
  }
  // windshield: faired into the front face of the shell (face runs
  // (z 0.50,y 0.96) -> (z 0.00,y 1.42): atan(0.50/0.46) = 47.4 deg from
  // vertical, length 0.68). Panel 0.60 tall, rotated EXACTLY along the
  // face — a few degrees off makes the corners poke through the roof
  // edge and read as a floating diagonal line.
  const windshield = box(1.50, 0.60, 0.02, MAT.glass, 0, 1.19, 0.25);
  windshield.rotation.x = THREE.MathUtils.degToRad(-47.4);
  body.add(windshield);
  // rear glass: face (z -1.30,y 1.40) -> (z -1.70,y 0.96):
  // atan(0.40/0.44) = 42.3 deg from vertical, length 0.59.
  const rearGlass = box(1.50, 0.52, 0.02, MAT.glass, 0, 1.18, -1.50);
  rearGlass.rotation.x = THREE.MathUtils.degToRad(42.3);
  body.add(rearGlass);

  // ---- sunroof: dark panel sunk flush into the shell roof (roof top at
  // y 1.42; panel top 1.422 — a proud panel reads as a line floating
  // above the roofline in side view)
  body.add(box(0.72, 0.02, 0.62, MAT.darkTrim, 0, 1.412, -0.70));

  // ---- bumpers: body-colour, flush with the body (the bevelled profile
  // already reads as a rounded bumper; separate slabs looked like extra
  // extrusions on the real car's smooth nose/tail).

  // ---- front fascia: SMALL narrow 2-bar grille + wide low mesh intake
  body.add(box(0.62, 0.10, 0.05, MAT.meshIntake, 0, 0.85, FRONT_Z - 0.01));
  body.add(box(0.62, 0.02, 0.06, MAT.chrome, 0, 0.85, FRONT_Z));         // chrome bar
  body.add(box(0.66, 0.02, 0.05, MAT.chrome, 0, 0.90, FRONT_Z - 0.005)); // chrome surround top
  body.add(box(1.30, 0.13, 0.05, MAT.meshIntake, 0, 0.47, FRONT_Z - 0.01)); // lower air dam
  // fog lamp recesses in the bumper corners
  body.add(box(0.16, 0.09, 0.04, MAT.meshIntake, 0.66, 0.47, FRONT_Z));
  body.add(box(0.16, 0.09, 0.04, MAT.meshIntake, -0.66, 0.47, FRONT_Z));

  // ---- headlights: one connected L-shaped cluster per side (front face
  // + fender wrap meeting at the corner, no gaps). The 2004 pre-facelift
  // has the amber turn/reflectors INSIDE the clear lens, not as a
  // separate side box — so the amber sits inset on the outer front face.
  // A dark bezel behind each lens makes the cluster read against the
  // silver body (white-on-silver was invisible from the front).
  for (const s of [1, -1]) {
    body.add(box(0.54, 0.21, 0.03, MAT.darkTrim, s * 0.59, 0.84, FRONT_Z - 0.028));   // bezel
    body.add(box(0.50, 0.17, 0.04, MAT.headlight, s * 0.59, 0.84, FRONT_Z - 0.015)); // front face (x 0.34..0.84)
    body.add(box(0.03, 0.15, 0.40, MAT.headlight, s * 0.895, 0.83, 1.85));           // fender wrap, kept clear of the bevelled nose corner
    body.add(box(0.10, 0.10, 0.045, MAT.amber, s * 0.76, 0.82, FRONT_Z - 0.007));    // inner amber section
    body.add(box(0.14, 0.05, 0.046, MAT.darkTrim, s * 0.45, 0.90, FRONT_Z - 0.006)); // projector cut
  }

  // ---- taillights: the CL7's are LARGE triangular wraparound clusters:
  // big face on the tail + long wrap up the quarter panel. Dark bezel +
  // taller face so the cluster reads as a housing, not a decal.
  for (const s of [1, -1]) {
    body.add(box(0.58, 0.26, 0.02, MAT.darkTrim, s * 0.58, 0.88, REAR_Z + 0.010));   // bezel (flush with tail face)
    body.add(box(0.52, 0.22, 0.03, MAT.taillight, s * 0.58, 0.88, REAR_Z + 0.015));  // face (4mm proud of tail face)
    body.add(box(0.03, 0.20, 0.72, MAT.taillight, s * 0.895, 0.88, -1.88));          // wrap sweeping forward along the quarter panel
    body.add(box(0.12, 0.06, 0.035, MAT.reverseLens, s * 0.40, 0.79, REAR_Z + 0.012)); // clear reverse strip, bottom edge
  }
  // (high-mount stop lamp omitted: the greenhouse is a solid extruded
  // slab, so any lamp near the rear glass is buried inside it and reads
  // as a floating bar.)

  // ---- beltline molding + body-colour door molding. Paint, not chrome:
  // the chrome strip reflected the blue sky and read as a blue racing
  // stripe along the whole shoulder (not an Accord feature).
  // Doors span cowl z=+0.50 to rear glass base z=-1.70.
  for (const s of [1, -1]) {
    body.add(box(0.015, 0.025, 2.05, MAT.paint, s * 0.902, 0.975, -0.60));
    body.add(box(0.015, 0.035, 1.90, MAT.paint, s * 0.902, 0.72, -0.60));
  }

  // ---- side mirrors: teardrop housing + small amber indicator, at the
  // foot of the A-pillar (shell face at z ~0.40 at mirror height).
  for (const s of [1, -1]) {
    body.add(box(0.05, 0.04, 0.10, MAT.darkTrim, s * 0.94, 1.02, 0.40));
    body.add(box(0.10, 0.12, 0.16, MAT.paint, s * 1.02, 1.06, 0.32));
    body.add(box(0.02, 0.04, 0.06, MAT.amber, s * 1.075, 1.05, 0.38));
  }

  // ---- door handles (body-colour pull-type, on the shoulder line)
  for (const s of [1, -1]) {
    body.add(box(0.03, 0.03, 0.16, MAT.paint, s * 0.915, 0.93, -0.15));
    body.add(box(0.03, 0.03, 0.16, MAT.paint, s * 0.915, 0.93, -0.90));
  }

  // ---- fuel filler door (left rear quarter)
  const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), MAT.paint);
  filler.rotation.z = Math.PI / 2;
  // fuel door sits AHEAD of the taillight wrap (wrap spans z -1.52..-2.24)
  filler.position.set(-0.905, 0.85, -1.30);
  body.add(filler);

  // ---- exhaust tip: single outlet on the car's LEFT side (USDM CL7),
  // tucked just inside the bumper face.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), MAT.chrome);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(-0.55, 0.32, REAR_Z + 0.05);
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

  // ---- wheel arch rings: the body is a flat extruded slab, so the
  // tires just poke through it and read as "oversized arches". A dark
  // half-torus ring on each side at the wheel plane draws a real arch
  // opening around each tire. Added to `group` (not `body`): they must
  // stay planted with the wheels while the sprung body heaves.
  for (const [x, y, z] of wheelPos) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(WHEEL_RADIUS + 0.075, 0.035, 6, 20, Math.PI),
      MAT.darkTrim);
    ring.rotation.y = Math.PI / 2;   // arc (XY, theta 0..pi) -> YZ, spans the top
    ring.position.set(Math.sign(x) * 0.905, y, z);
    group.add(ring);
  }

  // Taillight world positions for the anime streak emitter.
  const taillightAnchors = [
    [0.60, 0.88, REAR_Z], [-0.60, 0.88, REAR_Z],
    [0.885, 0.88, -1.95], [-0.885, 0.88, -1.95],
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
