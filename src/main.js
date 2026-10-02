import * as THREE from 'three';
import { SIM } from './config.js';
import { createCar } from './car.js';
import { createEnvironment } from './environment.js';
import { createParticles } from './particles.js';

const container = document.getElementById('app');
const speedLabel = document.getElementById('speed');

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
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
      horizon: { value: new THREE.Color(0xcfd8e0) },
      bottom: { value: new THREE.Color(0x2a2d31) },
      sunDir: { value: new THREE.Vector3(0.5, 0.35, 0.6).normalize() },
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
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6))
                         : mix(horizon, bottom, pow(-h, 0.5));
        float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 220.0);
        c += vec3(1.0, 0.95, 0.85) * sun * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  return envScene;
}

// Visible sky dome (matches env colors, sits far away).
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    top: { value: new THREE.Color(0x3a6ea8) },
    horizon: { value: new THREE.Color(0xbcc7d2) },
    bottom: { value: new THREE.Color(0x24272b) },
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
      vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6))
                       : mix(horizon, bottom, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat));

// Atmospheric fog — haze everything that rushes past.
scene.fog = new THREE.Fog(0xbcc7d2, 40, 220);

// ---------------------------------------------------------------- camera
const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(-4.6, 2.1, -5.4); // low 3/4 rear-left chase view

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0x9db8d8, 0x3a3f45, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2df, 2.6);
sun.position.set(14, 16, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
scene.add(sun);

// Cool rim light from behind-left to carve the silver edges.
const rim = new THREE.DirectionalLight(0x7fa8d0, 1.1);
rim.position.set(-10, 6, -14);
scene.add(rim);

// ---------------------------------------------------------------- actors
const car = createCar();
scene.add(car.group);

const environment = createEnvironment();
scene.add(environment.group);

const particles = createParticles();
scene.add(particles.group);

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Gentle speed oscillation so the sim feels alive (110-130 km/h).
  SIM.speedKmh = SIM.baseSpeedKmh + Math.sin(clock.elapsedTime * 0.7) * 10;
  SIM.distance += SIM.speedMs * dt;

  car.update(dt, clock.elapsedTime);
  environment.update(dt);
  particles.update(dt);

  // Camera micro-sway synced to speed.
  camera.position.y = 2.1 + Math.sin(clock.elapsedTime * 5.3) * 0.008 * SIM.speedKmh * 0.05;
  camera.lookAt(0, 0.75, 0.6);

  speedLabel.textContent = Math.round(SIM.speedKmh);
  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------- resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
