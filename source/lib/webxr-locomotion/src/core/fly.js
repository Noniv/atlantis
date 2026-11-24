// Flight (README.md § Fly): the two-hand glide's throttle and velocity, step flight, and the planet speed model.

import { clamp, smoothstep } from './math.js';

/**
 * Spread ratio to throttle: neutral between glideNeutralLow and glideNeutralHigh, full forward at glideFull, full
 * reverse at glideFullBack; 0 for a non-finite or non-positive spread.
 * [R] WorldWalking.swift:182-186 glideThrottle; [V] StreamedWorld.swift:758-763
 */
export function throttle(spread, k) {
  if (!Number.isFinite(spread) || !(spread > 0)) return 0;
  if (spread >= k.glideNeutralHigh) return Math.min((spread - k.glideNeutralHigh) / (k.glideFull - k.glideNeutralHigh), 1);
  if (spread < k.glideNeutralLow) return -Math.min((k.glideNeutralLow - spread) / (k.glideNeutralLow - k.glideFullBack), 1);
  return 0;
}

/** Eases the glide speed toward its target at glideEase per second. [R] MetalWalking.swift:710 */
export const easeSpeed = (speed, target, dt, k) => speed + (target - speed) * (1 - Math.exp(-dt * k.glideEase));

/**
 * The glide's world velocity from the head's world forward vector and the eased speed (negative backs up).
 * Walking: horizontal only. Flying ([R-Metal] MetalWalking.swift:711-725): level while the gaze is within
 * flyLevelBand of horizontal; beyond it, climb or dive at up to flyClimb · min(1, speed / glideWalkSpeed), scaled by
 * how far past the band; horizontal speed is speed · cos(pitch). `followPitch` gives R-RK's full-gaze flight instead.
 */
export function glideVelocity(forward, speed, { flying, followPitch = false }, k) {
  const flat = Math.hypot(forward.x, forward.z);
  if (!flying) {
    if (flat < 1e-3) return { x: 0, y: 0, z: 0 };
    return { x: (forward.x / flat) * speed, y: 0, z: (forward.z / flat) * speed };
  }
  if (followPitch) return { x: forward.x * speed, y: forward.y * speed, z: forward.z * speed };
  const pitch = Math.asin(clamp(forward.y, -1, 1));
  const past = Math.max(0, Math.abs(pitch) - k.flyLevelBand) / (Math.PI / 2 - k.flyLevelBand);
  const horizontal = flat > 1e-3 ? speed * Math.cos(pitch) : 0;
  // Signed as in the origin, so backing up while looking up descends; clamped at −1 so a full-speed reverse never
  // dives faster than flyClimb (the origin's min(1, v/6) alone reaches −4 × flyClimb at −24 m/s).
  const climb = (pitch > 0 ? 1 : -1) * past * k.flyClimb * clamp(speed / k.glideWalkSpeed, -1, 1);
  return {
    x: flat > 1e-3 ? (forward.x / flat) * horizontal : 0,
    y: climb,
    z: flat > 1e-3 ? (forward.z / flat) * horizontal : 0,
  };
}

/** Step flight's intent from the spread ratio: +1 spread, −1 narrowed, 0 neutral. [V] StreamedWorld.swift:823 */
export const stepIntent = (spread, k) => (spread > k.stepUp ? 1 : spread < k.stepDown ? -1 : 0);

/** One step's length: clamp(stepGain · world metres per room metre, stepMin, stepMax). [V] Geography.swift:843 */
export const stepDistance = (worldPerRoom, k) => clamp(k.stepGain * worldPerRoom, k.stepMin, k.stepMax);

/** Planet base speed from height above ground. [V] Geography.swift:876 */
export const planetSpeed = (heightAboveGround, k) =>
  clamp(heightAboveGround * k.planetSpeedGain, k.planetSpeedMin, k.planetSpeedMax);

/** Planet boost: ×1 to ×(1 + planetBoost) over the top half of the throttle. [V] Geography.swift:878-880 */
export const planetBoost = (t, k) => 1 + k.planetBoost * smoothstep(Math.max(0, (Math.abs(t) - 0.5) * 2));

/** World metres per room metre at a height above ground. [V] Geography.swift:1057 */
export const planetScale = (heightAboveGround, k) => Math.max(k.planetScaleMin, heightAboveGround / k.planetScaleDivisor);

/**
 * Keeps a planet height between the floor and planetCeiling. With known ground the floor is ground + planetClearance.
 * With unknown terrain below planetUnknownFloor, horizontal motion waits (`waiting`) and the height may not drop
 * below the lower of where it was and planetUnknownFloor. [V] Geography.swift:883-892
 * @param {number} next the height the move wants
 * @param {number} previous the height before the move
 * @param {number|null} groundHeight null where the terrain is unknown
 */
export function planetHeight(next, previous, groundHeight, k) {
  if (groundHeight === null || groundHeight === undefined || !Number.isFinite(groundHeight)) {
    if (next < k.planetUnknownFloor) {
      return { height: Math.max(next, Math.min(previous, k.planetUnknownFloor)), waiting: true };
    }
    return { height: Math.min(next, k.planetCeiling), waiting: false };
  }
  return { height: clamp(next, groundHeight + k.planetClearance, k.planetCeiling), waiting: false };
}

/** The smooth teleport's duration. [R-Metal] MetalWalking.swift:745-769 */
export const dashSeconds = (d, k) => Math.min(k.dashBase + d / k.dashSpeed, k.dashLongest);
