import * as THREE from 'three';
import { SIM } from './config.js';
import { createCar } from './car.js';
import { createEnvironment } from './environment.js';
import { createParticles } from './particles.js';
import { createClouds } from './clouds.js';

const container = document.getElementById('app');
const speedLabel = document.getElementById('speed');

// ?capture=1 switches to deterministic scripted rendering (see scripts/capture.py)
const CAPTURE = new URLSearchParams(location.search).has('capture');

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // needed so CDP screenshots see the WebGL buffer after the render call
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();

// Procedural sky environment -> reflections for the clearcoat paint.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(buildSkyEnvScene(), 0.04).texture;

function buildSkyEnvScene() {
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(50, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(0x3a6ea8) },
      horizon: { value: new THREE.Color(0xe8eef4) },
      bottom: { value: new THREE.Color(0x1e2124) },
      sunDir: { value: new THREE.Vector3(10, 9, 14).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55))
                         : mix(horizon, bottom, pow(-h, 0.4));
        float d = dot(normalize(vDir), sunDir);
        // tight sun disc + wide glow -> sharp specular streaks on the paint
        c += vec3(1.0, 0.95, 0.85) * pow(max(d, 0.0), 300.0) * 12.0;
        c += vec3(1.0, 0.9, 0.75) * pow(max(d, 0.0), 24.0) * 1.2;
        // bright horizon band = strong reflection across the flanks
        c += vec3(0.9, 0.95, 1.0) * pow(1.0 - abs(h), 14.0) * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  return envScene;
}

// Visible sky dome (matches env colors, sits far away).
// Design pass: golden-hour grading — deep blue zenith, warm horizon band
// (teal/orange complementary contrast against the red streaks).
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    top: { value: new THREE.Color(0x24517f) },
    horizon: { value: new THREE.Color(0xf0c894) },
    bottom: { value: new THREE.Color(0x3a3d41) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
    varying vec3 vDir;
    void main() {
      float h = vDir.y;
      vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5))
                       : mix(horizon, bottom, pow(-h, 0.5));
      // golden-hour sun bloom low on the horizon near the vanishing point
      // (wide soft falloff — tight exponents read as a skybox seam)
      float d = max(dot(normalize(vDir), normalize(vec3(0.5, 0.02, 0.85))), 0.0);
      c += vec3(1.0, 0.62, 0.30) * pow(d, 3.0) * 0.45;
      c += vec3(1.0, 0.75, 0.45) * pow(d, 18.0) * 0.8;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat));

// Atmospheric fog — atmospheric perspective: distant props fade toward
// a warm pale haze, keeping the strongest contrast in the foreground.
scene.fog = new THREE.Fog(0xd8c8b2, 30, 170);

// ---------------------------------------------------------------- camera
const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(-4.2, 2.0, -5.6); // low 3/4 rear-left chase view

// ---------------------------------------------------------------- lights
// Golden-hour key: low warm sun = long dramatic shadow + warm paint
// highlights; cool rim stays complementary.
const hemi = new THREE.HemisphereLight(0x9db8d8, 0x55594e, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd9a6, 3.0);
sun.position.set(10, 9, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0004;
scene.add(sun);

// Cool rim light from behind-left to carve the silver edges (subject
// separation against the pale haze).
const rim = new THREE.DirectionalLight(0x8fb8e8, 2.0);
rim.position.set(-10, 6, -14);
scene.add(rim);

// Warm low kicker from the right: grazes the flank and traces a golden
// edge along the silhouette toward the camera (focal emphasis).
const kicker = new THREE.DirectionalLight(0xff9a5a, 1.6);
kicker.position.set(12, 2.5, 4);
scene.add(kicker);

// ---------------------------------------------------------------- actors
const car = createCar();
scene.add(car.group);

const environment = createEnvironment();
scene.add(environment.group);

const particles = createParticles(car.taillightAnchors);
scene.add(particles.group);

const clouds = createClouds();
scene.add(clouds.group);

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();

function step(dt, t) {
  // Gentle speed oscillation so the sim feels alive (110-130 km/h).
  SIM.speedKmh = SIM.baseSpeedKmh + Math.sin(t * 0.7) * 10;
  SIM.distance += SIM.speedMs * dt;

  car.update(dt, t);
  environment.update(dt);
  particles.update(dt, t);
  clouds.update(dt);

  // Camera micro-sway synced to speed.
  camera.position.y = 2.0 + Math.sin(t * 5.3) * 0.008 * SIM.speedKmh * 0.05;
  // Rule of thirds: bias the look target right so the car sits on the
  // left vertical third with the vanishing point on the right third.
  camera.lookAt(0.7, 0.8, 0.9);

  speedLabel.textContent = Math.round(SIM.speedKmh);
  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt, clock.elapsedTime);
}

// ---------------------------------------------------------------- capture mode
// `?capture=1` freezes the free-run loop and exposes a deterministic
// fixed-timestep renderer for the frame-grab script (scripts/capture.py).
if (CAPTURE) {
  const CAPTURE_DT = 1 / 30;
  window.__scene = scene;
  window.__camera = camera;
  window.__sim = {
    dt: CAPTURE_DT,
    renderFrame(i) {
      SIM.distance = i * CAPTURE_DT * SIM.speedMs; // reset for determinism
      step(CAPTURE_DT, i * CAPTURE_DT);
    },
  };
  window.__simReady = true;
} else {
  animate();
}

// ---------------------------------------------------------------- resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
