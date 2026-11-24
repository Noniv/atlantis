// Turning (README.md § Turn): the flick, the drag turn and the stick snap.

import { angleBetween, clamp, headingOf } from './math.js';

/**
 * The turn a pinch on the sky or a wall makes: its swing from where it began to where it ended, seen from the head;
 * a swing to the left turns left. 0 for a pinch that didn't swing past flickAngle.
 * [G] FocusRoomFit.swift:FocusLocomotion.turn(swingFrom:to:); [M] GalleryRooms.jsx:398-406
 */
export function flickTurn(startHeading, endHeading, k) {
  const swing = angleBetween(startHeading, endHeading);
  return Math.abs(swing) > k.flickAngle ? Math.sign(swing) * k.snapTurn : 0;
}

/** The heading of the hand around the head, in tracking space (so turning the rig doesn't move it). [R] MetalWalking.swift:headingAround */
export const headingAround = (head, hand) => headingOf(hand.x - head.x, hand.z - head.z);

/**
 * One frame of the drag turn: opposite to the hand's swing around you, at dragGain of it. In `planet` each sample
 * is clamped to ±planetTurnClamp ([V] StreamedWorld.swift:941). [R] MetalWalking.swift:295-305
 */
export function dragTurn(lastHeading, nowHeading, k, { clampSample = false } = {}) {
  const turn = -angleBetween(lastHeading, nowHeading) * k.dragGain;
  return clampSample ? clamp(turn, -k.planetTurnClamp, k.planetTurnClamp) : turn;
}

/** Whether a pinch held on an object has become a drag: held past dragIntentDelay and moved past dragIntentDistance. [R] MetalWalking.swift:287-294 */
export const dragIntended = (heldFor, moved, k) => heldFor > k.dragIntentDelay && Math.hypot(moved.x, moved.z) > k.dragIntentDistance;

/**
 * The right stick's snap turn: one ±stickTurn when |x| passes stickFire, re-armed below stickRearm. Starts unarmed,
 * so a stick already pushed when the controller appears does nothing until it centres. Right turns right.
 * [R] MetalWalking.swift:1133-1141; [V] Geography.swift:679-683
 */
export class StickSnap {
  constructor() {
    this.armed = false;
  }

  reset() {
    this.armed = false;
  }

  /** @returns {number} the turn this frame, 0 for none */
  update(rawX, k) {
    let turn = 0;
    if (this.armed && Math.abs(rawX) > k.stickFire) {
      this.armed = false;
      turn = rawX > 0 ? -k.stickTurn : k.stickTurn;
    }
    if (Math.abs(rawX) < k.stickRearm) this.armed = true;
    return turn;
  }
}
