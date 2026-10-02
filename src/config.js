/**
 * Shared simulation constants and helpers.
 * World axes: +X = car's right, +Y = up, +Z = forward (car faces +Z).
 */
export const SIM = {
  speedMph: 75,           // current speed, modulated in main loop (mph)
  baseSpeedMph: 75,
  distance: 0,            // meters travelled (drives texture scroll + particles)
  get speedMs() {
    return this.speedMph * 0.44704;
  },
};

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}
