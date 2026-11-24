// Walking and flying over the host's ground, sliding along walls (README.md § Ground and walls). World space; the
// "feet" are the head's floor spot. Port of [R] MetalWalking.swift:770-849 (moves) and 1182-1211 (unblocked).

import { dot, length, normalize, scale, sub, add } from './math.js';

/**
 * A ground query from a host raycast: the first surface straight down from `fromY`, up to groundDepth.
 * @returns {(x:number, z:number, fromY:number) => ({y:number, level:number, water:boolean}|null)}
 */
export function groundFromRaycast(cast, k) {
  return (x, z, fromY) => {
    const hit = cast({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, k.groundDepth);
    return hit ? { y: hit.point.y, level: hit.normal.y, water: hit.kind === 'water' } : null;
  };
}

/**
 * A move with what's in its way taken out: the part into a wall goes, the rest slides along it, for at most two walls
 * (a corner). Rays from three heights above the feet; walking, the lowest is just above what a step climbs, and
 * walls push back across the floor only. [R] MetalWalking.swift:unblocked
 */
export function slideMove(move, feet, flying, cast, k) {
  const heights = flying ? [0.1, 0.9, 1.7] : [k.maxStep + k.stepSlack, 1.1, 1.7];
  let m = move;
  for (let i = 0; i < 2; i++) {
    const len = length(m);
    if (len <= 1e-5) return { x: 0, y: 0, z: 0 };
    const direction = scale(m, 1 / len);
    let nearest = null;
    for (const h of heights) {
      const hit = cast(add(feet, { x: 0, y: h, z: 0 }), direction, len + k.bodyRadius);
      if (hit && hit.kind !== 'water' && hit.kind !== 'ui' && hit.distance < (nearest?.distance ?? Infinity)) nearest = hit;
    }
    if (!nearest) return m;
    let normal = nearest.normal;
    if (!flying) {
      normal = normalize({ x: normal.x, y: 0, z: normal.z });
      if (!normal) return { x: 0, y: 0, z: 0 };
    }
    const into = dot(m, normal);
    if (into >= 0) return m;
    m = sub(m, scale(normal, into));
  }
  return m;
}

/**
 * One frame of walking or flying from `feet` by `step` (world metres).
 * Walking ([R] MetalWalking.swift:812-829): the feet ease toward the footing at groundFollowRate, never more than
 * footClamp off it; a step up of more than maxStep, a drop deeper than maxDrop, water, a slope too steep to go down,
 * or no ground stops the move (and the caller zeroes its speed: "a fall in view is the motion that sickens").
 * Flying ([R] MetalWalking.swift:806-811): the feet stay at or above the ground; coming down within landingHeight
 * of it lands.
 *
 * @param {object} w
 * @param {(x:number, z:number, fromY:number) => ({y:number, level?:number, water?:boolean}|null)} w.ground
 * @param {(from, to, info) => {x,y,z}} [w.collide] host override of the wall slide
 * @param {(origin, dir, max) => object|null} w.cast
 * @param {number} [w.waterY]
 * @param {number} surface the footing height under the feet last frame (or feet.y)
 * @returns {{feet: {x,y,z}, surface: number, stopped: boolean, landed: boolean}}
 */
export function walkStep(feet, step, { flying, dt }, w, surface, k) {
  const base = flying ? feet : { x: feet.x, y: Math.max(feet.y, surface), z: feet.z };
  let next = w.collide
    ? w.collide(feet, add(feet, step), { flying })
    : add(feet, slideMove(step, base, flying, w.cast, k));
  const probeY = flying ? next.y + k.maxStep + k.stepSlack : base.y + k.maxStep + k.stepSlack;
  const underfoot = w.ground(next.x, next.z, probeY);
  if (flying) {
    if (!underfoot) return { feet: next, surface, stopped: false, landed: false };
    let landed = false;
    if (next.y - underfoot.y < k.landingHeight && step.y < 0) {
      landed = true;
      next = { ...next, y: underfoot.y };
    }
    return { feet: { ...next, y: Math.max(next.y, underfoot.y) }, surface: underfoot.y, stopped: false, landed };
  }
  const water = w.waterY ?? -Infinity;
  if (
    underfoot && !underfoot.water && underfoot.y > water - k.waterMargin &&
    underfoot.y - surface < k.maxStep + k.stepSlack &&
    surface - underfoot.y < k.maxDrop &&
    ((underfoot.level ?? 1) >= k.levelEnough || underfoot.y >= surface)
  ) {
    const eased = feet.y + (underfoot.y - feet.y) * Math.min(1, k.groundFollowRate * dt);
    const y = Math.min(Math.max(eased, underfoot.y - k.footClamp), underfoot.y + k.footClamp);
    return { feet: { ...next, y }, surface: underfoot.y, stopped: false, landed: false };
  }
  return { feet, surface, stopped: true, landed: false };
}
