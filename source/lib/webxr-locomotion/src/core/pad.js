// Controllers (README.md § Controller): one normalised pad snapshot from either a standard gamepad (an Xbox
// controller paired to the headset; [V] math.js:gamepadState) or the two xr-standard Touch controllers (*inferred*).
// Stick y is up-positive here; the browser's is down-positive.

import { StickSnap } from './turn.js';

/**
 * @typedef {object} PadInput
 * @property {string} id                 changes when a different controller appears
 * @property {'standard'|'xr-standard'} mapping
 * @property {{x:number, y:number}} left raw, up-positive
 * @property {{x:number, y:number}} right raw, up-positive
 * @property {{a:boolean, b:boolean, x:boolean, y:boolean, menu:boolean, l3:boolean, r3:boolean}} buttons
 * @property {number} boost              0…1: RT (standard) or the right squeeze (xr-standard)
 */

const BUTTONS = ['a', 'b', 'x', 'y', 'menu', 'l3', 'r3'];

/**
 * A standard-mapping gamepad as a PadInput, or null. Only `mapping === 'standard'` with at least 16 buttons counts:
 * xr-standard pads (Quest Touch, and Vision Pro's "pinch pads") are rejected here. [V] math.js:207-209
 * Buttons: A 0, B 1, X 2, Y 3, RT 7 (value), Menu 9, L3 10, R3 11.
 */
export function readStandardPad(pad) {
  if (!pad?.connected || pad.mapping !== 'standard' || !(pad.buttons?.length >= 16)) return null;
  const b = (i) => !!pad.buttons[i]?.pressed;
  const axis = (i) => (Number.isFinite(pad.axes?.[i]) ? pad.axes[i] : 0);
  return {
    id: `standard:${pad.index ?? 0}:${pad.id ?? ''}`,
    mapping: 'standard',
    left: { x: axis(0), y: -axis(1) },
    right: { x: axis(2), y: -axis(3) },
    buttons: { a: b(0), b: b(1), x: b(2), y: b(3), menu: b(9), l3: b(10), r3: b(11) },
    boost: pad.buttons[7]?.value ?? 0,
  };
}

/**
 * Two xr-standard controllers (no hand) as one PadInput, or null. *Inferred, untested on a device:* thumbstick
 * axes[2]/[3], trigger [0], squeeze [1], stick press [3], A/X [4], B/Y [5]. The trigger is the select button (it
 * already teleports, turns and presses the panel), so boost is the right squeeze; turbo is the left stick press;
 * there is no Menu button exposed, so Touch exits from the panel.
 * @param {Gamepad|null} left
 * @param {Gamepad|null} right
 */
export function readXRStandardPads(left, right) {
  const ok = (g) => g && g.mapping === 'xr-standard' && (g.axes?.length ?? 0) >= 4;
  const l = ok(left) ? left : null, r = ok(right) ? right : null;
  if (!l && !r) return null;
  const stick = (g) => (g ? { x: g.axes[2] || 0, y: -(g.axes[3] || 0) } : { x: 0, y: 0 });
  const b = (g, i) => !!g?.buttons?.[i]?.pressed;
  return {
    id: `xr-standard:${l ? 'L' : ''}${r ? 'R' : ''}`,
    mapping: 'xr-standard',
    left: stick(l),
    right: stick(r),
    buttons: { a: b(r, 4), b: b(r, 5), x: b(l, 4), y: b(l, 5), menu: false, l3: b(l, 3), r3: b(r, 3) },
    boost: r?.buttons?.[1]?.value ?? 0,
  };
}

/** A radial dead zone, rescaled so full deflection still reaches 1. [V] math.js:210-216 with [R]'s 0.24 */
export function radialDeadZone(x, y, deadZone) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length < deadZone) return { x: 0, y: 0 };
  const k = Math.min(1, (length - deadZone) / (1 - deadZone)) / length;
  return { x: x * k, y: y * k };
}

/**
 * The pad over time: press edges, the connect-held rule, turbo, the Menu hold and the snap turn.
 * [R] MetalWalking.swift:1086-1180
 */
export class Pad {
  constructor() {
    this.snap = new StickSnap();
    this.reset(null);
    this.needsCentre = true;
  }

  /** A different controller (or none): buttons start as held, so one down when it appears counts only after release. */
  reset(id) {
    this.id = id;
    this.held = Object.fromEntries(BUTTONS.map((name) => [name, true]));
    this.turbo = false;
    this.menuSince = Infinity;
    // Sticks too: one pushed when the controller appears moves nothing until it has centred (invariant 7).
    this.needsCentre = true;
    this.snap.reset();
  }

  /** After a pause the sticks must centre again before they move you. */
  requireCentre() {
    this.needsCentre = true;
  }

  /** Recentre (Y / R3) clears turbo, as in the origins. [R] WorldWalking.swift:639-643; [V] Geography.swift:645-656 */
  clearTurbo() {
    this.turbo = false;
  }

  /**
   * @param {PadInput|null} input
   * @returns {null | {left:{x,y}, right:{x,y}, rawTurn:number, mode:number, turn:number, edges:Record<string,boolean>,
   *   exit:boolean, active:boolean, centred:boolean}}
   */
  update(input, time, k) {
    if (!input) {
      if (this.id !== null) this.reset(null);
      return null;
    }
    if (input.id !== this.id) this.reset(input.id);
    const edges = {};
    for (const name of BUTTONS) {
      const pressed = !!input.buttons[name];
      edges[name] = pressed && !this.held[name];
      this.held[name] = pressed;
    }
    if (edges.l3) this.turbo = !this.turbo;
    let exit = false;
    if (input.buttons.menu) {
      if (this.menuSince === null) this.menuSince = time;
      if (time - this.menuSince > k.menuHold) {
        this.menuSince = Infinity;
        exit = true;
      }
    } else {
      this.menuSince = null;
    }
    let left = radialDeadZone(input.left.x, input.left.y, k.padDeadZone);
    let right = radialDeadZone(input.right.x, input.right.y, k.padDeadZone);
    const centred = left.x === 0 && left.y === 0 && right.x === 0 && right.y === 0;
    if (this.needsCentre) {
      if (centred) this.needsCentre = false;
      else {
        left = { x: 0, y: 0 };
        right = { x: 0, y: 0 };
      }
    }
    const rawTurn = Number.isFinite(input.right.x) ? input.right.x : 0;
    const mode = this.turbo ? k.padTurbo : input.boost > k.padBoostThreshold ? k.padBoost : 1;
    const turn = this.snap.update(rawTurn, k);
    const active = left.x !== 0 || left.y !== 0 || right.y !== 0;
    return { left, right, rawTurn, mode, turn, edges, exit, active, centred };
  }
}

/**
 * The sticks' world velocity: the left stick along the head's level facing and across, the right stick up and down
 * while flying, at padWalkSpeed or padFlySpeed times the mode. [R] MetalWalking.swift:1160-1175
 * @param {{x,y,z}} forward the head's world forward
 */
export function padVelocity(state, forward, flying, k, cruise = flying ? k.padFlySpeed : k.padWalkSpeed) {
  const flat = Math.hypot(forward.x, forward.z);
  const f = flat < 0.01 ? { x: 0, z: -1 } : { x: forward.x / flat, z: forward.z / flat };
  // right = forward × up
  const r = { x: -f.z, z: f.x };
  const speed = cruise * state.mode;
  const v = {
    x: (r.x * state.left.x + f.x * state.left.y) * speed,
    y: flying ? state.right.y * speed : 0,
    z: (r.z * state.left.x + f.z * state.left.y) * speed,
  };
  return v;
}
