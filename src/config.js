/**
 * Shared simulation constants and helpers.
 * World axes: +X = car's right, +Y = up, +Z = forward (car faces +Z).
 */
export const SIM = {
  speedKmh: 120,          // current speed, modulated in main loop
  baseSpeedKmh: 120,
  distance: 0,            // meters travelled (drives texture scroll + particles)
  get speedMs() {
    return this.speedKmh / 3.6;
  },
};

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}
