import * as THREE from 'three';
import { SIM } from './config.js';

/**
 * Volumetric-style cumulus: the sky dome is raymarched in the fragment
 * shader against procedural 3D value noise (faked volumetrics, no clipart
 * sprites). NOTE: sampler3D/DataArrayTexture fetches return 0 on
 * SwiftShader (verified by raw-alpha debug render), so noise is computed
 * in-shader with a hash lattice.
 *
 * MARCH DOMAIN: a fixed-distance march along the view ray, NOT a box slab.
 * A box slab was failure mode 0: at +/-1500 m wide, a ray at 5 deg
 * elevation only rose ~130 m before leaving the slab, so it sampled just
 * the bottom edge of the cloud layer and every cloud was a thin streak.
 *
 * CELL SCALE vs LAYER DEPTH: weather cells must be LARGER than the layer
 * thickness. With small cells, a shallow ray crosses many columns and hits
 * at least one -> uniform overcast sheet (failure mode 1). With ~3 km
 * cells and an 820 m layer, a 20-deg ray crosses ~1 cell (cloud or clear)
 * and a 5-deg ray crosses ~3 -> discrete towers with real perspective.
 *
 * The cloud mesh is a mask for "which pixels look at sky": a sphere
 * slightly inside the sky dome, depth-tested so hills and the car
 * occlude clouds, depthWrite off so it never occludes anything.
 *
 * Density = 2D weather map (one value per xz column) x vertical layer
 * profile x 3D billow erosion. Lighting = height at CLOUD entry (the
 * flank of the tower the eye actually sees): bright cream where the ray
 * clips the upper flank, warm gray where it clips the base. Sun direction
 * matches the sky dome's golden-hour bloom. Returns { group, update(dt) }.
 */

// Cloud layer: cumulus base ~120 m, tops up to ~800 m. The layer is kept
// THIN relative to the cell size: the visible sky band is only ~15 deg
// tall, and 1.5 km towers at 8 km filled it edge-to-edge, merging every
// cloud into its neighbor (the "smeared patch" failure). yTop is raised
// so mid-elevation rays (5-10 deg) still cross real cloud depth instead
// of exiting the layer after 1-2 cells (the "clouds hug the horizon"
// failure).
const LAYER = { yBot: 120, yTop: 800 };
// March distance is clamped per-pixel to where the ray exits the layer
// top, so near-horizon rays don't march 16 km through empty air.
const MARCH_MAX = 16000.0;
const SEARCH_M = 200.0;   // coarse step through empty sky
const FINE_M = 25.0;      // fine step inside cloud (crisp silhouette)
const MAX_ITERS = 80;
// Column threshold: weather2 measured in-page = N(0.510, 0.117). Center
// 0.60 = ~0.8 sd above the mean -> ~23% of columns grow clouds. With 3 km
// cells that is ~23% of the upper sky and ~55% near the horizon.
const THR0 = 0.590, THR1 = 0.610;

// ---------------------------------------------------------------- shader
const CLOUD_VERT = /* glsl */ `
  out vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const CLOUD_FRAG = /* glsl */ `
  precision highp float;
  in vec3 vWorld;
  out vec4 fragColor;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uScroll;
  uniform vec2 uLayerY;     // yBot, yTop
  uniform float uCoverage;  // 0..1 cloud amount

  // --- procedural 3D value noise (sampler3D fetches return 0 on SwiftShader)
  float hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                  mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                  mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }

  // 2D weather map: ONE value per (x,z) column -> discrete towers, not a
  // sheet. Cells (~3 km) are LARGER than the layer thickness (820 m) so a
  // ray crossing the layer samples 1-3 columns, not 10+.
  float weather2(vec2 xz) {
    vec2 q = xz + vec2(uScroll * 0.35, uScroll);
    // ~800 m cells: bigger than the 500 m layer (avoids the overcast
    // sheet) but small enough that 4-6 towers fit across the sky band
    // with clear gaps between them.
    return vnoise(vec3(q * 0.0013, 7.3)) * 0.60
         + vnoise(vec3(q * 0.0026, 11.7)) * 0.28
         + vnoise(vec3(q * 0.0052, 31.3)) * 0.12;
  }

  // Towering cumulus: weather2 sets each column's strength AND top height.
  float density(vec3 p) {
    float h = (p.y - uLayerY.x) / (uLayerY.y - uLayerY.x);
    if (h < 0.0 || h > 1.0) return 0.0;
    float w = weather2(p.xz);
    float col = smoothstep(${THR0.toFixed(3)} - uCoverage * 0.012, ${THR1.toFixed(3)} - uCoverage * 0.008, w);
    if (col <= 0.001) return 0.0;
    // Stronger weather = taller tower. The top range must sit BELOW the
    // column threshold center (0.60), or every passing column gets
    // top=min and the cloud collapses to a razor-thin band (failure mode
    // 2: slivers). 3D noise bumps the top so crowns are lobed, not flat.
    float top = mix(0.45, 0.95, smoothstep(0.55, 0.80, w))
              + (vnoise(p * vec3(0.0035, 0.0035, 0.0035) + 5.1) - 0.5) * 0.22;
    float vert = smoothstep(0.08, 0.13, h) * (1.0 - smoothstep(top - 0.30, top, h));
    // Cauliflower billows erode the WHOLE silhouette (not just the top:
    // gating erosion by height produced straight-sided BROWN BLOCKS).
    // Lobe period ~180 m on an 800 m tower = 3-4 lobes across = cumulus.
    float billow = vnoise(p * vec3(0.0055, 0.0045, 0.0055)) * 0.60
                 + vnoise(p * vec3(0.0120, 0.0100, 0.0120) + 31.3) * 0.40;
    float er = smoothstep(0.32, 0.44, billow);
    return col * vert * er * 1.8;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - cameraPosition);

    // horizon fade: only the last ~1 degree is suppressed (hills stay
    // visible); a wider fade erased the cloud BASES and left towers
    // floating detached above the horizon.
    float horizonFade = smoothstep(0.004, 0.020, rd.y);
    if (horizonFade <= 0.0) { fragColor = vec4(0.0); return; }

    const float g = 0.42;                   // HG asymmetry (forward scatter)
    float cosT = dot(rd, uSunDir);
    float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));

    // per-pixel march clamp: past the layer top there is nothing to hit
    float tMax = min(${MARCH_MAX.toFixed(1)}, (uLayerY.y + 150.0 - ro.y) / rd.y);

    float T = 1.0;
    float depth = 0.0;     // total optical depth along the ray
    float hit = 0.0;
    float entryH = 0.0;    // height fraction where the ray enters the CLOUD
    float t = 0.0;
    float dt = ${SEARCH_M.toFixed(1)};
    bool inCloud = false;

    for (int i = 0; i < ${MAX_ITERS}; i++) {
      vec3 p = ro + rd * t;
      float d = density(p);
      if (d > 0.001) {
        if (!inCloud) {
          inCloud = true; hit = 1.0;
          t -= dt;
          p = ro + rd * t;
          entryH = (p.y - uLayerY.x) / (uLayerY.y - uLayerY.x);
        }
        dt = ${FINE_M.toFixed(1)};
        depth += d * dt;
      } else {
        inCloud = false;
        dt = ${SEARCH_M.toFixed(1)};
      }
      t += dt;
      if (t > tMax) break;
    }

    // Shading by OPTICAL DEPTH + sky-relative value. Measured sky values:
    // horizon sky lum ~250 (blown-out orange), upper sky lum ~145. A single
    // cloud value can't contrast against both. Real cumulus solve this
    // naturally: near the horizon you see the DARK shadowed base against
    // bright haze; high up you see bright flanks against dark sky. The
    // cloud's value range tracks ray elevation. Colors are NEUTRAL-COOL
    // (warm beige against blue sky read as BROWN BLOCKS).
    // CRITICAL: this raw ShaderMaterial bypasses three.js tonemapping +
    // colorspace encoding, so linear values >= 1.0 clipped to 255 (the
    // "blown-out white" failure) and mid values rendered too dark. Apply
    // the same ACES fit + sRGB encode the rest of the scene gets, then
    // pick values on that final scale. ACES+sRGB compresses midtones
    // brutally: linear 0.25 -> lum ~170, linear 0.34 -> lum ~192 (measured
    // "dark" cores rendered lum 190 = the sky = invisible). To land a
    // shadowed base at lum ~105 use linear ~0.10; bright rim lum ~215 =
    // linear ~0.55. Wide range = dramatic golden-hour cumulus.
    float highness = smoothstep(0.02, 0.18, rd.y);
    float thick = 1.0 - exp(-depth * 0.004);        // saturates fast: even
                                                    // a thin grazing slice
                                                    // reaches mid gray
    float flank = smoothstep(0.10, 0.55, entryH);   // upper flank brighter
    vec3 rimCol = mix(vec3(0.50, 0.49, 0.48), vec3(0.58, 0.57, 0.56), highness);
    vec3 coreCol = mix(vec3(0.08, 0.09, 0.12), vec3(0.16, 0.17, 0.22), highness);
    vec3 cloudCol = mix(rimCol, coreCol, thick);
    cloudCol = mix(cloudCol, rimCol, flank * 0.55);
    // break up the flat interior: FINE, subtle mottling (a coarse 250 m
    // mottle read as smeared painterly texture at cloud distance)
    vec3 endp = ro + rd * min(t, tMax);
    cloudCol *= 0.94 + 0.12 * vnoise(endp * 0.009 + 17.0);
    cloudCol += uSunColor * hg * 0.10 * (1.0 - thick);   // silver lining
    cloudCol = min(cloudCol, vec3(1.0));
    cloudCol *= 1.15;   // renderer.toneMappingExposure
    cloudCol = clamp((cloudCol * (2.51 * cloudCol + 0.03)) / (cloudCol * (2.43 * cloudCol + 0.59) + 0.14), 0.0, 1.0);
    cloudCol = pow(cloudCol, vec3(1.0 / 2.2));
    float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    cloudCol += (dth - 0.5) / 255.0;

    // HARD silhouette with a THIN optical soft edge: binary alpha aliased
    // the outline (stair-stepping); fully soft alpha feathered over tens
    // of px (blurry blob). Fast ramp = clouds are OPAQUE masses; slow
    // ramps let the warm horizon sky bleed through at 30-70% alpha and
    // read as tan/brown haze patches inside the cloud.
    float alpha = smoothstep(10.0, 60.0, depth) * horizonFade;
    fragColor = vec4(cloudCol, alpha);
  }`;

// ---------------------------------------------------------------- factory
export function createClouds() {
  const group = new THREE.Group();

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, 0.28, 0.85).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.78, 0.55) },
      uScroll: { value: 0 },
      uLayerY: { value: new THREE.Vector2(LAYER.yBot, LAYER.yTop) },
      uCoverage: { value: 0.40 },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,   // camera inside: march outward over the whole sky
  });

  // Slightly inside the sky dome (radius 1600) so it draws over the sky
  // gradient but stays inside the camera far plane.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  dome.renderOrder = 1;
  group.add(dome);

  function update(dt) {
    // clouds drift backward with parallax (slow, they are far away)
    mat.uniforms.uScroll.value = SIM.distance * 0.012;
  }

  return { group, update };
}
