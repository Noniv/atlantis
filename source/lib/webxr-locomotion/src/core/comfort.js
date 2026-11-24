// The comfort layer (README.md § Comfort): the curtain every discontinuous move goes through, and the vignette for
// continuous motion. Both are frame-driven: they advance only when the kit's update() steps them.

import { mix, smoothstepRange } from './math.js';

/**
 * Fade to black, move, (hold the dark while the host confirms), fade back in. [M] FadeCurtain.jsx;
 * [R] WorldWalking.swift:740-785 and AppModel.swift:784-788 for the held dark.
 *
 * A move is `{rig, from, reason, crossing?, after?}`. The instruction step() returns tells the kit what to do:
 * - `{apply: move}` at full dark: put the rig there (and ask the host to confirm, if it wants to);
 * - `{revert: move}` the host refused while still dark: back to `from`;
 * - `{confirmed: move}` the host said yes: the move's bookkeeping may run now;
 * - `{landed: move, rig}` the host put the person somewhere else (a server's own landing);
 * - `{timedOut: move}` no answer within the hold: the new rig stays;
 * - `{done: move}` fully clear again.
 */
export class Curtain {
  constructor() {
    this.level = 0;
    this.phase = 'clear';
    this.move = null;
  }

  get busy() {
    return this.phase !== 'clear';
  }

  /** Starts a move; false if one is already under way (README.md § Arbitration, 6). */
  start(move) {
    if (this.busy) return false;
    this.move = { ...move, confirm: 'none', outcome: undefined, deadline: Infinity };
    this.phase = 'closing';
    return true;
  }

  /** The host's confirmation is pending: hold the dark until `deadline` (seconds, the kit's clock). */
  hold(deadline) {
    if (!this.move) return;
    this.move.confirm = 'pending';
    this.move.deadline = deadline;
  }

  /** Adds time to the hold, e.g. a server teleport that crosses into another region. */
  extend(seconds) {
    if (this.move && Number.isFinite(this.move.deadline)) this.move.deadline += seconds;
  }

  /** The host's answer: true or undefined lands, false refuses, a rig lands there instead. */
  resolve(outcome) {
    const m = this.move;
    if (!m || m.confirm !== 'pending') return false;
    m.outcome = outcome;
    m.confirm = 'done';
    return true;
  }

  step(dt, time, k) {
    const step = dt / k.fadeSeconds;
    const m = this.move;
    switch (this.phase) {
      case 'closing':
        this.level = Math.min(1, this.level + step);
        if (this.level >= 1) {
          this.level = 1;
          this.phase = 'dark';
          return { apply: m };
        }
        return {};
      case 'dark': {
        if (m.confirm === 'pending' && time < m.deadline) return {};
        this.phase = 'opening';
        if (m.confirm === 'pending') {
          m.confirm = 'timeout';
          return { timedOut: m };
        }
        if (m.outcome === false) return { revert: m };
        if (m.outcome && typeof m.outcome === 'object') return { landed: m, rig: m.outcome };
        if (m.confirm === 'done') return { confirmed: m };
        return {};
      }
      case 'opening':
        this.level = Math.max(0, this.level - step);
        if (this.level <= 0) {
          this.level = 0;
          this.phase = 'clear';
          this.move = null;
          return { done: m };
        }
        return {};
      default:
        return {};
    }
  }
}

/**
 * The vignette's level for continuous motion: the larger of the turn rate (full at vignetteFullTurnRate), the speed
 * (vignetteMoveShare at vignetteMoveSpeed and above) and vignetteDash while dashing; it rises at vignetteRise and
 * falls at vignetteFall per second. Snap turns add nothing. [R-Metal] MetalWalking.swift:966-970
 */
export class Vignette {
  constructor() {
    this.level = 0;
  }

  update(dt, { turned = 0, speed = 0, dashing = false }, k) {
    const turnRate = turned / Math.max(dt, 1e-3);
    const wanted = Math.max(
      Math.min(turnRate / k.vignetteFullTurnRate, 1),
      Math.min(speed / k.vignetteMoveSpeed, 1) * k.vignetteMoveShare,
      dashing ? k.vignetteDash : 0,
    );
    this.level += (wanted - this.level) * Math.min(1, dt * (wanted > this.level ? k.vignetteRise : k.vignetteFall));
    if (this.level < 1e-4) this.level = 0;
    return vignetteParams(this.level, k);
  }
}

/** What a renderer needs to draw the vignette: the clear angle and the soft band beyond it (radians from ahead). */
export const vignetteParams = (level, k) => ({
  level,
  clear: mix(k.vignetteClearStill, k.vignetteClearFull, level),
  band: k.vignetteBand,
  gate: smoothstepRange(0, k.vignetteGate, level),
});

/**
 * The head-locked overlay's darkness at `angle` radians from straight ahead: the vignette's edge, or the curtain,
 * whichever is darker. A port of [R-Metal] Shaders.metal:overlay_fragment, for tests and for shader ports.
 */
export function overlayAlpha(angle, level, curtain, k) {
  const inner = mix(k.vignetteClearStill, k.vignetteClearFull, level);
  const edge = smoothstepRange(inner, inner + k.vignetteBand, angle) * smoothstepRange(0, k.vignetteGate, level);
  return Math.max(edge, curtain);
}
