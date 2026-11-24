// Pure maths: headings, the rig, small vector helpers and the 1€ filter.
//
// Conventions (README.md § Coordinates and maths): metres, right-handed, +Y up, −Z forward. A heading (yaw) is 0
// looking down −Z, positive turning left. The rig {x, y, z, yaw, scale} is the world pose of the tracking-space
// origin: a tracking point p appears in the world at R(yaw)·(scale·p) + (x, y, z).

/** @typedef {{x:number, y:number, z:number}} Vec3 */
/** @typedef {{x:number, y:number, z:number, w:number}} Quat */
/** @typedef {{x:number, y:number, z:number, yaw:number, scale:number}} Rig */
/** @typedef {{x:number, y?:number, z:number, yaw:number}} Spot */

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
/** GLSL/MSL smoothstep(edge0, edge1, x). */
export const smoothstepRange = (edge0, edge1, x) => smoothstep((x - edge0) / (edge1 - edge0));

/** [M] teleport.js:headingOf; [G] FocusLocomotion.heading */
export const headingOf = (dx, dz) => Math.atan2(-dx, -dz);

/** The smallest signed difference from `from` to `to`, in (−π, π]. [M] teleport.js:angleBetween */
export const angleBetween = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Frame time clamped before any integration (invariant 10). Non-finite or negative becomes 0. */
export const clampDt = (dt, max) => (Number.isFinite(dt) ? clamp(dt, 0, max) : 0);

// Vectors: plain {x, y, z} objects, never mutated.
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a) => Math.hypot(a.x, a.y, a.z);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const normalize = (a, fallback = null) => {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : fallback;
};
export const finite3 = (a) => !!a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Rotates v by the unit quaternion q. */
export function rotate(q, v) {
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** The unit quaternion turning `yaw` about +Y. */
export const yawQuat = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/**
 * A head pose as the kit uses it: position, forward and right unit vectors, heading and pitch. When looking
 * straight up or down the heading falls back to the head's right vector ([V] StreamedWorld.swift:812-818).
 * @param {{position: Vec3, orientation: Quat}} pose
 */
export function headFromPose(pose) {
  const forward = normalize(rotate(pose.orientation, { x: 0, y: 0, z: -1 }), { x: 0, y: 0, z: -1 });
  const right = normalize(rotate(pose.orientation, { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });
  const level = Math.hypot(forward.x, forward.z);
  // Looking straight up or down, the level forward is the right vector turned a quarter left: (right.z, −right.x).
  const yaw = level > 1e-4 ? headingOf(forward.x, forward.z) : headingOf(right.z, -right.x);
  return { position: pose.position, forward, right, yaw, pitch: Math.asin(clamp(forward.y, -1, 1)) };
}

// The rig.

/** @returns {Rig} */
export const makeRig = (rig = {}) => ({ x: rig.x ?? 0, y: rig.y ?? 0, z: rig.z ?? 0, yaw: rig.yaw ?? 0, scale: rig.scale ?? 1 });

/** A tracking-space point in the world. [M] useGalleryNavigation.js:headInWorld */
export function toWorld(rig, p) {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw), k = rig.scale;
  const x = p.x * k, z = p.z * k;
  return { x: rig.x + c * x + s * z, y: rig.y + p.y * k, z: rig.z - s * x + c * z };
}

/** A tracking-space direction in the world (rotation only; directions are not scaled). */
export function dirToWorld(rig, d) {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
  return { x: c * d.x + s * d.z, y: d.y, z: -s * d.x + c * d.z };
}

/** A world point in tracking space: the inverse of toWorld. */
export function toTracking(rig, w) {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw), k = rig.scale;
  const dx = w.x - rig.x, dz = w.z - rig.z;
  return { x: (c * dx - s * dz) / k, y: (w.y - rig.y) / k, z: (s * dx + c * dz) / k };
}

/** A world direction in tracking space. */
export function dirToTracking(rig, d) {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
  return { x: c * d.x - s * d.z, y: d.y, z: s * d.x + c * d.z };
}

/**
 * The rig that puts the head (tracking x, z, yaw) over a world spot, facing its heading, with the tracking floor at
 * `floorY`. [M] teleport.js:originForSpot; [G] FocusWorldPose(placing:under:raised:); [R] MetalWalking.swift:395-413.
 * @param {{x:number, z:number, yaw:number}} head
 * @param {{x:number, z:number, yaw:number}} spot
 */
export function rigForSpot(head, spot, floorY, scale = 1) {
  const yaw = spot.yaw - head.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = head.x * scale, hz = head.z * scale;
  return { x: spot.x - (c * hx + s * hz), y: floorY, z: spot.z - (-s * hx + c * hz), yaw, scale };
}

/** The head's floor spot and heading in the world. `head` is from headFromPose. */
export function headSpot(rig, head) {
  const p = toWorld(rig, { x: head.position.x, y: 0, z: head.position.z });
  return { x: p.x, y: p.y, z: p.z, yaw: rig.yaw + head.yaw };
}

/**
 * The rig moved `forward` and `right` (metres along the person's facing) and turned by `turn` where they stand,
 * on the floor they're on. [G] FocusRoomFit.swift:FocusLocomotion.nudging
 */
export function nudgeRig(rig, head, { forward = 0, right = 0, turn = 0 } = {}) {
  const here = headSpot(rig, head);
  const x = here.x - Math.sin(here.yaw) * forward + Math.cos(here.yaw) * right;
  const z = here.z - Math.cos(here.yaw) * forward - Math.sin(here.yaw) * right;
  return rigForSpot({ x: head.position.x, z: head.position.z, yaw: head.yaw }, { x, z, yaw: here.yaw + turn }, rig.y, rig.scale);
}

/** The rig turned by `angle` about the head's vertical axis. */
export const turnRigAboutHead = (rig, head, angle) => nudgeRig(rig, head, { turn: angle });

/**
 * The rig turned by `angle` about a world pivot (gevvr's one-hand turn about the picked map point).
 * [V] Geography.swift:769-833
 */
export function turnRigAbout(rig, pivot, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = rig.x - pivot.x, dz = rig.z - pivot.z;
  return { ...rig, x: pivot.x + c * dx + s * dz, z: pivot.z - s * dx + c * dz, yaw: rig.yaw + angle };
}

/** The rig as a column-major 4×4 world-from-tracking matrix (scale included). */
export function rigMatrix(rig, out = new Float32Array(16)) {
  const c = Math.cos(rig.yaw) * rig.scale, s = Math.sin(rig.yaw) * rig.scale;
  out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0;
  out[4] = 0; out[5] = rig.scale; out[6] = 0; out[7] = 0;
  out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = rig.x; out[13] = rig.y; out[14] = rig.z; out[15] = 1;
  return out;
}

/**
 * A tracking-space frame {centre, x, up, z} as a column-major world-from-frame matrix (unit axes; the frame's
 * width and height are separate). Scale is applied to the axes so the frame keeps its world size under rig.scale.
 */
export function frameMatrix(rig, f, out = new Float32Array(16)) {
  const x = scale(dirToWorld(rig, f.x), rig.scale), up = scale(dirToWorld(rig, f.up), rig.scale);
  const z = scale(dirToWorld(rig, f.z), rig.scale), c = toWorld(rig, f.centre);
  out[0] = x.x; out[1] = x.y; out[2] = x.z; out[3] = 0;
  out[4] = up.x; out[5] = up.y; out[6] = up.z; out[7] = 0;
  out[8] = z.x; out[9] = z.y; out[10] = z.z; out[11] = 0;
  out[12] = c.x; out[13] = c.y; out[14] = c.z; out[15] = 1;
  return out;
}

/** True when two rigs differ by more than `epsilon` in any component. */
export const rigsDiffer = (a, b, epsilon = 1e-6) =>
  Math.abs(a.x - b.x) > epsilon || Math.abs(a.y - b.y) > epsilon || Math.abs(a.z - b.z) > epsilon ||
  Math.abs(angleBetween(a.yaw, b.yaw)) > epsilon || Math.abs(a.scale - b.scale) > epsilon;

/**
 * How far one floor spot is from another in the first's own frame: metres ahead and to the right, and the turn,
 * a positive one to the left. [G] FocusRoomFit.swift:FocusOffset
 */
export function offsetFrom(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return {
    ahead: -Math.sin(from.yaw) * dx - Math.cos(from.yaw) * dz,
    right: Math.cos(from.yaw) * dx - Math.sin(from.yaw) * dz,
    turn: angleBetween(from.yaw, to.yaw),
  };
}

/** Rounds halves away from zero, as Swift's `.rounded()` does (Math.round rounds −0.5 up to −0). */
export const roundAway = (x) => Math.sign(x) * Math.round(Math.abs(x));

/** Metres in words: "3.2 m", "45 cm", "4 mm". [G] FocusEnvironmentFitView.swift:198-204 */
export function lengthWords(metres) {
  if (!Number.isFinite(metres)) return '—';
  const size = Math.abs(metres);
  if (size >= 1) return `${metres.toFixed(1)} m`;
  if (size >= 0.01) return `${roundAway(metres * 100)} cm`;
  return `${roundAway(metres * 1000)} mm`;
}

/** "Raised 3 cm"; "Standing on the floor". [G] FocusEnvironmentFitView.swift:186-189 */
export const floorWords = (raise) =>
  Math.abs(raise) < 0.005 ? 'Standing on the floor' : raise > 0 ? `Raised ${lengthWords(raise)}` : `Lowered ${lengthWords(-raise)}`;

/** "4 cm ahead, 2 cm left, turned 1° right"; "Where you start". [G] FocusEnvironmentNudgeView.swift:148-158 */
export function offsetWords(offset) {
  const parts = [];
  if (roundAway(offset.ahead * 100) !== 0) parts.push(`${lengthWords(Math.abs(offset.ahead))} ${offset.ahead > 0 ? 'ahead' : 'back'}`);
  if (roundAway(offset.right * 100) !== 0) parts.push(`${lengthWords(Math.abs(offset.right))} ${offset.right > 0 ? 'right' : 'left'}`);
  const degrees = roundAway((offset.turn * 180) / Math.PI);
  if (degrees !== 0) parts.push(`turned ${Math.abs(degrees)}° ${degrees > 0 ? 'left' : 'right'}`);
  return parts.length ? parts.join(', ') : 'Where you start';
}

/**
 * The 1€ filter (Casiez, Roussel and Vogel, CHI 2012) on a Vec3: a low-pass whose cutoff rises with speed.
 * [R] MetalWrist.swift:OneEuro
 */
export class OneEuro {
  constructor(minCutoff, beta, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.value = null;
    this.speed = { x: 0, y: 0, z: 0 };
  }

  filter(v, dt) {
    const last = this.value;
    if (!last || !(dt > 0)) {
      this.value = v;
      return v;
    }
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const a = alpha(this.derivativeCutoff);
    const rate = scale(sub(v, last), 1 / dt);
    this.speed = add(this.speed, scale(sub(rate, this.speed), a));
    const out = add(last, scale(sub(v, last), alpha(this.minCutoff + this.beta * length(this.speed))));
    this.value = out;
    return out;
  }
}
