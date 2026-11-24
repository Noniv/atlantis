// The floor target (README.md § Teleport) and jumps to named destinations (§ Jump). World space throughout.

import { angleBetween, clamp, headingOf, normalize, sub } from './math.js';

/**
 * @typedef {object} Hit
 * @property {{x:number,y:number,z:number}} point
 * @property {{x:number,y:number,z:number}} normal
 * @property {number} distance
 * @property {'floor'|'solid'|'water'|'object'|'ui'} kind
 * @property {unknown} [object]
 * @property {string} [destination]
 */

/** Level enough to stand on. [G] FocusRoomFit.swift:224; [R] WorldWalking.swift:62 */
export const isLevel = (hit, k) => !!hit && hit.normal.y >= k.levelEnough;

/**
 * Whether a pinch may land on a hit.
 * - floorOnly ([G], room): level, and within floorTolerance of the floor the person stands on — never a desk's top,
 *   a shelf or a step. [G] FocusRoomFit.swift:canLand
 * - otherwise ([R], region): level and not water. [R] WorldWalking.swift:505-506, MetalWalking.swift:263
 */
export function canLand(hit, { floorOnly, floorY, k }) {
  if (!isLevel(hit, k) || hit.kind === 'water' || hit.kind === 'ui') return false;
  return floorOnly ? Math.abs(hit.point.y - floorY) <= k.floorTolerance : true;
}

/** The facing chosen by moving the pinching hand. NaN `current` means "keep whatever it was". [M] floorTarget.js:handHeading */
export const handHeading = (dx, dz, current, k) => (Math.hypot(dx, dz) > k.deadZone ? headingOf(dx, dz) : current);

/**
 * Where the head is aimed on the floor, for the ring: a ray from the head along its forward vector, shown only on
 * landable surfaces. [M] FloorTeleport.jsx:48-61; [G] FocusEnvironmentWalking.swift:411-423; [R] MetalWalking.swift:960-964
 */
export function ringHit(head, forward, cast, { floorOnly, floorY, reach, k }) {
  if (forward.y >= k.lookingDown) return null;
  const hit = cast(head, forward, reach);
  return hit && canLand(hit, { floorOnly, floorY, k }) ? hit : null;
}

/**
 * What lies between the eye and a pinched level point, by the nearest hit along a ray to it (distance + 0.05 m):
 * a wall in between makes the pinch a turn; anything level (a desk) is the surface the pinch is on, and canLand
 * decides. Nothing hit: the pinched point itself, as level. [G] FocusEnvironmentWalking.swift:342-357;
 * [R] WorldWalking.swift:495-508
 * @returns {{kind:'wall'} | {kind:'level', hit: Hit}}
 */
export function obstruction(eye, pinched, cast, k) {
  const to = sub(pinched.point, eye);
  const length = Math.hypot(to.x, to.y, to.z);
  if (length <= k.obstructionMin) return { kind: 'wall' };
  const hit = cast(eye, normalize(to), length + k.obstructionSlack);
  if (!hit) return { kind: 'level', hit: { ...pinched, normal: { x: 0, y: 1, z: 0 } } };
  if (hit.normal.y < k.levelEnough) return { kind: 'wall' };
  return { kind: 'level', hit };
}

/**
 * Keeps a landing spot on the floor areas, clear of their walls; otherwise the nearest such spot.
 * @param {Array<{x?:number, z?:number, width:number, depth:number, margin?:number|{x:number,z:number}}>} floors
 * [M] floorTarget.js:insideFloors
 */
export function insideFloors(spot, floors, k) {
  if (!floors?.length) return { x: spot.x, z: spot.z };
  let nearest = null;
  for (const { depth, margin = k.wallMargin, width, x = 0, z = 0 } of floors) {
    const m = typeof margin === 'number' ? { x: margin, z: margin } : margin;
    const candidate = {
      x: clamp(spot.x, x - width / 2 + m.x, x + width / 2 - m.x),
      z: clamp(spot.z, z - depth / 2 + m.z, z + depth / 2 - m.z),
    };
    const d = Math.hypot(candidate.x - spot.x, candidate.z - spot.z);
    if (!nearest || d < nearest.d) nearest = { d, ...candidate };
  }
  return { x: nearest.x, z: nearest.z };
}

/**
 * Keeps a point `margin` inside the world's bounds: a box {min, max} or a disc {centre, radius}. Height is left
 * alone. [R] AppModel.swift:629-640 (0.5 m inside an edge with no region beyond)
 */
export function insideBounds(point, bounds, margin) {
  if (!bounds) return point;
  if (bounds.min && bounds.max) {
    return {
      ...point,
      x: clamp(point.x, bounds.min.x + margin, bounds.max.x - margin),
      z: clamp(point.z, bounds.min.z + margin, bounds.max.z - margin),
    };
  }
  if (bounds.centre && bounds.radius) {
    const dx = point.x - bounds.centre.x, dz = point.z - bounds.centre.z;
    const r = Math.hypot(dx, dz), most = Math.max(0, bounds.radius - margin);
    if (r <= most) return point;
    return { ...point, x: bounds.centre.x + (dx / r) * most, z: bounds.centre.z + (dz / r) * most };
  }
  return point;
}

/**
 * The floor height a landing puts under the person ([R] MetalWalking.swift:landing(on:facing:)): the level footing
 * under the landed feet if one lies within ±maxStep of the target's height, otherwise the target's own height.
 * Measured under the head's landed spot (the kit has no avatar at the rig origin).
 */
export function landingFloor(target, feet, ground, k) {
  const under = ground?.(feet.x, feet.z, target.y + k.footingRange);
  if (under && !under.water && Math.abs(under.y - target.y) <= k.footingRange && (under.level ?? 1) >= k.levelEnough) {
    return under.y;
  }
  return target.y;
}

/** Where to stand to look at a station from `distance` in front of it. [M] galleryLayout.js:viewingSpot */
export const viewingSpot = ({ x, yaw, z }, d) => ({ x: x + Math.sin(yaw) * d, yaw, z: z + Math.cos(yaw) * d });

/**
 * The station a visitor standing at `spot` is in front of and facing: within its viewing distance plus `reach`,
 * on its front side, and no more than `maxAngle` from looking straight at it. Index, or -1. [M] teleport.js:stationInFront
 */
export function stationInFront(spot, stations, k) {
  let best = -1;
  let bestDistance = Infinity;
  stations.forEach(({ view, x, yaw, z }, index) => {
    if (view === undefined) return;
    const dx = spot.x - x;
    const dz = spot.z - z;
    const d = Math.hypot(dx, dz);
    const inFront = dx * Math.sin(yaw) + dz * Math.cos(yaw) > 0;
    const facing = Math.abs(angleBetween(spot.yaw, headingOf(-dx, -dz))) <= k.stationMaxAngle;
    if (inFront && facing && d <= view + k.stationReach && d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

/** The spot a destination puts the head on: its viewing spot if it has a viewing distance, else itself. */
export function destinationSpot(destination, close = false) {
  if (destination.view !== undefined) {
    const d = close && destination.close !== undefined ? destination.close : destination.view;
    return { ...viewingSpot(destination, d), y: destination.y ?? 0 };
  }
  return { x: destination.x, y: destination.y ?? 0, z: destination.z, yaw: destination.yaw ?? 0 };
}
