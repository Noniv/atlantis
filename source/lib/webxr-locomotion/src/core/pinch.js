// Pinches from hand joints, for the two-hand pair when `hand-tracking` is granted (README.md § Fly). One-hand verbs
// always come from session select events; this only recognises "both hands pinched" and tells a deliberate release
// from lost tracking. Port of [V] StreamedWorld.swift:TrackedFlightPinches (lines 470-505), whose reason for being:
// build 84's system hand events "never registered a pair or movement".

import { distance, finite3, scale, add } from './math.js';

/**
 * The pinch point (between thumb and index tips) and the gap between them. Null unless both tips are tracked.
 * [V] StreamedWorld.swift:2389-2414
 */
export function pinchOf(joints) {
  if (!joints?.thumbTip || !joints?.indexTip || !finite3(joints.thumbTip) || !finite3(joints.indexTip)) return null;
  return { point: scale(add(joints.thumbTip, joints.indexTip), 0.5), gap: distance(joints.thumbTip, joints.indexTip) };
}

/**
 * Both hands pinched, with hysteresis per hand (closed below pinchClose, open again above pinchOpen). The pair arms
 * only after both hands have been seen open; while active, letting either hand open ends it deliberately; losing a
 * hand, losing permission or not being allowed cancels it, and the hands must be seen open again before it re-arms.
 */
export class JointPinches {
  constructor() {
    this.leftClosed = false;
    this.rightClosed = false;
    this.initialized = false;
    this.blocked = true;
    this.active = false;
  }

  /**
   * @param {{point, gap}|null} left
   * @param {{point, gap}|null} right
   * @param {{available: boolean, allowed: boolean}} gate available: joints reported at all; allowed: nothing else owns the hands
   * @returns {{phase: 'idle'|'started'|'active'|'ended'|'cancelled', left, right}}
   */
  update(left, right, { available, allowed }, k) {
    const valid = (h) => (h && finite3(h.point) && Number.isFinite(h.gap) && h.gap >= 0 && h.gap <= k.pinchMaxGap ? h : null);
    const l = valid(left), r = valid(right);
    this.leftClosed = l ? l.gap < (this.leftClosed ? k.pinchOpen : k.pinchClose) : false;
    this.rightClosed = r ? r.gap < (this.rightClosed ? k.pinchOpen : k.pinchClose) : false;
    const was = this.active;
    const tracked = !!l && !!r;
    const neutral = tracked && !this.leftClosed && !this.rightClosed;
    let deliberate = false;
    if (!available) {
      this.initialized = false;
      this.blocked = true;
      this.active = false;
    } else {
      if (!this.initialized) {
        this.initialized = true;
        this.blocked = !neutral;
      }
      if (!allowed || !tracked) {
        this.active = false;
        this.blocked = !neutral;
      } else if (neutral) {
        deliberate = was;
        this.active = false;
        this.blocked = false;
      } else if (!this.blocked && this.leftClosed && this.rightClosed) {
        this.active = true;
      } else if (this.active) {
        // One hand opened while the other still pinches: a deliberate end; re-arm only once both are open.
        deliberate = true;
        this.active = false;
        this.blocked = true;
      }
    }
    let phase = 'idle';
    if (this.active) phase = was ? 'active' : 'started';
    else if (was) phase = deliberate && available && allowed && tracked ? 'ended' : 'cancelled';
    return { phase, left: l, right: r };
  }

  /** True when the joints show no hand pinching (or no hands): part of the neutral re-arm (invariant 7). */
  get open() {
    return !this.leftClosed && !this.rightClosed;
  }
}
