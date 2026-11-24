// Renderer-neutral geometry for what the kit asks the host to draw (README.md § Teleport, § Comfort): typed arrays a
// three.js BufferGeometry, a WebGL2 buffer or a WebGPU buffer can take as they are. Floor markers lie in the XZ
// plane facing +Y; the panel quad lies in its own XY plane facing +Z with uv (0,0) top-left.

import { K } from '../core/constants.js';

/** Colours and alphas. [M] FloorTeleport.jsx:12-13, 101-123 */
export const STYLE = Object.freeze({
  ring: { color: '#ffffff', alpha: K.ringAlpha },
  target: { color: '#3ec46d', alpha: K.targetAlpha },
  cancelled: { color: '#8a8a8a', alpha: K.targetAlpha },
  arrow: { color: '#ffffff', alpha: 1 },
  curtain: { color: '#000000' },
});

/**
 * The heading arrow's outline in the floor plane (x, z), tip toward −Z at yaw 0. [M] FloorTeleport.jsx:19-27
 * (the shape's +y is −z once laid on the floor).
 */
export const ARROW_OUTLINE = Object.freeze([
  [0, -0.34], [0.14, -0.08], [0.05, -0.08], [0.05, 0.16], [-0.05, 0.16], [-0.05, -0.08], [-0.14, -0.08],
]);

/** Indices for triangle (a, b, c) of XZ positions, wound so the face points +Y (counter-clockwise seen from above). */
function upward(positions, a, b, c) {
  const ax = positions[a * 3], az = positions[a * 3 + 2];
  const bx = positions[b * 3], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cz = positions[c * 3 + 2];
  // y of (b − a) × (c − a)
  const y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  return y > 0 ? [a, b, c] : [a, c, b];
}

const flat = (points) => {
  const positions = new Float32Array(points.length * 3);
  points.forEach(([x, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 2] = z;
  });
  return positions;
};

/** The look-down ring: an annulus. [M] FloorTeleport.jsx:102 */
export function ringGeometry(inner = K.ringInner, outer = K.ringOuter, segments = 48) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([Math.cos(a) * inner, Math.sin(a) * inner], [Math.cos(a) * outer, Math.sin(a) * outer]);
  }
  const positions = flat(points);
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    indices.push(...upward(positions, i * 2, i * 2 + 1, j * 2 + 1), ...upward(positions, i * 2, j * 2 + 1, j * 2));
  }
  return { positions, indices: new Uint16Array(indices) };
}

/** The target disc. [M] FloorTeleport.jsx:107 */
export function discGeometry(radius = K.targetRadius, segments = 48) {
  const points = [[0, 0]];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const positions = flat(points);
  const indices = [];
  for (let i = 1; i <= segments; i++) indices.push(...upward(positions, 0, i, (i % segments) + 1));
  return { positions, indices: new Uint16Array(indices) };
}

/** The arrow: its head and its stem. */
export function arrowGeometry() {
  const positions = flat(ARROW_OUTLINE);
  const indices = [
    ...upward(positions, 0, 1, 6), // head
    ...upward(positions, 2, 3, 4), ...upward(positions, 2, 4, 5), // stem
  ];
  return { positions, indices: new Uint16Array(indices) };
}

/** A width × height quad centred on its origin, facing +Z, with uv (0,0) top-left: the panel and the tab. */
export function quadGeometry(width = 1, height = 1) {
  const w = width / 2, h = height / 2;
  return {
    positions: new Float32Array([-w, h, 0, w, h, 0, w, -h, 0, -w, -h, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 3, 2, 0, 2, 1]),
  };
}

/** A column-major matrix placing a floor marker at `position`, turned to `yaw`. */
export function placeMatrix(position, yaw = 0, out = new Float32Array(16)) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, position.x, position.y, position.z, 1]);
  return out;
}

/**
 * The head-locked overlay (vignette and curtain) as a full-screen fragment pass. Port of [R-Metal]
 * Shaders.metal:overlay_fragment. Inputs: the view ray in eye space, `vignette` (level 0…1) and `curtain` (0…1).
 * Blend premultiplied over the scene; draw last with depth test off.
 */
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** The overlay as WGSL, with a host's constants (loco.constants) if it overrode the vignette's. */
export const overlayWGSL = (k = K) => /* wgsl */ `
fn locomotion_overlay(ray_eye: vec3<f32>, vignette: f32, curtain: f32) -> f32 {
  let angle = acos(clamp(-normalize(ray_eye).z, -1.0, 1.0));
  let inner = mix(${f(k.vignetteClearStill)}, ${f(k.vignetteClearFull)}, vignette);
  let edge = smoothstep(inner, inner + ${f(k.vignetteBand)}, angle) * smoothstep(0.0, ${f(k.vignetteGate)}, vignette);
  return max(edge, curtain);
}`;

/** The overlay as GLSL ES 3.0. */
export const overlayGLSL = (k = K) => /* glsl */ `
float locomotionOverlay(vec3 rayEye, float vignette, float curtain) {
  float angle = acos(clamp(-normalize(rayEye).z, -1.0, 1.0));
  float inner = mix(${f(k.vignetteClearStill)}, ${f(k.vignetteClearFull)}, vignette);
  float edge = smoothstep(inner, inner + ${f(k.vignetteBand)}, angle) * smoothstep(0.0, ${f(k.vignetteGate)}, vignette);
  return max(edge, curtain);
}`;

export const OVERLAY_WGSL = overlayWGSL();
export const OVERLAY_GLSL = overlayGLSL();
