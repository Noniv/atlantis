// Who owns a pinch (README.md § Arbitration). One owner per pinch, decided at its start and kept until it ends
// ([V] VerifySnapshot.swift:1593: a cancelled contact cannot change owner). Highest priority first:
//   1. pause (host menu, blur, Menu, lost head) and the neutral re-arm   → blocked
//   2. the wrist panel (or its tab), or host UI the ray hits              → panel / tab / hostUI
//   3. a two-hand pair (a second pinch while a one-hand gesture is live)  → pairMember
//   4. an active controller                                               → blocked
//   5. a one-hand pinch, classified once on its first frame               → object / press / swing / drag
//   6. a move in progress                                                 → blocked
// Every position here is tracking space unless named `world`; kit.cast takes world rays.

import { distance, dirToWorld, headingOf, sub, toWorld } from './math.js';
import { canLand, handHeading, insideBounds, insideFloors, isLevel, obstruction } from './teleport.js';
import { dragIntended, dragTurn, flickTurn, headingAround } from './turn.js';

const blocked = () => ({ kind: 'blocked' });

/** Routes every pointer of the frame to its owner; owned pointers missing from the frame are cancelled. */
export function routePointers(kit, pointers) {
  kit.pointerById = new Map(pointers.map((p) => [p.id, p]));
  const seen = new Set();
  for (const p of pointers) {
    seen.add(p.id);
    route(kit, p);
  }
  for (const [id, owner] of [...kit.owners]) {
    if (!seen.has(id)) route(kit, { ...(owner.pointer ?? {}), id, phase: 'cancel' });
  }
}

function route(kit, p) {
  let owner = kit.owners.get(p.id);
  if (!owner) {
    // A pointer first seen after its start (the kit wasn't running, or it was dropped) is ignored until it ends.
    owner = p.phase === 'start' ? claim(kit, p) : blocked();
    owner.pointerId = p.id;
    kit.owners.set(p.id, owner);
  }
  owner.pointer = p;
  const handler = HANDLERS[owner.kind]?.[p.phase];
  if (handler) handler(kit, owner, p);
  if (p.phase === 'end' || p.phase === 'cancel') kit.owners.delete(p.id);
}

/** Decides a new pinch's owner. */
function claim(kit, p) {
  const k = kit.k;
  if (kit.paused || kit.neutralNeeded || kit.moving || !kit.head) return blocked();
  const ray = p.startRay ?? p.ray;
  if (!ray) return blocked();

  // 2. The panel or its tab.
  const panelHit = kit.wrist.rayHit(ray.origin, ray.dir, !!kit.wristOut?.usable);
  if (panelHit?.target === 'panel') {
    const found = kit.panel.itemAt(panelHit.uv);
    if (!found) return { kind: 'panel', index: null, item: null };
    const owner = { kind: 'panel', index: found.index, item: found.item, gripStart: p.grip, moved: false, since: kit.time, lastRepeat: kit.time };
    if (found.item.repeat) kit.pressPanel(found.index);
    return owner;
  }
  if (panelHit?.target === 'tab') return { kind: 'tab', gripStart: p.grip, moved: false };
  if (kit.wristOut?.hover) return blocked();
  // The tab's panel is open: a pinch anywhere else closes it, and does nothing more.
  if (kit.wrist.mount === 'tab' && kit.wrist.tabOpen) {
    kit.toggleTab();
    return blocked();
  }

  // 3. A pair already under way takes up to two pinches.
  if (kit.pair) {
    if (kit.pair.members.size < 2) {
      kit.pair.members.add(p.id);
      return { kind: 'pairMember' };
    }
    return blocked();
  }

  const worldRay = { origin: toWorld(kit.rig, ray.origin), dir: dirToWorld(kit.rig, ray.dir) };
  const hit = kit.cast(worldRay.origin, worldRay.dir, kit.profile.reach);
  if (hit?.kind === 'ui') return { kind: 'hostUI' };

  // 3. A second pinch from the other hand while a one-hand gesture is live: the pair, which beats objects [V].
  if (kit.gesture) {
    const g = kit.gesture;
    if (kit.profile.glide !== 'off' && (g.hand === 'none' || p.hand === 'none' || g.hand !== p.hand)) {
      kit.startPair('select', [g.pointerId, p.id]);
      return { kind: 'pairMember' };
    }
    return blocked();
  }

  // 4. The controller, and the lockout after a glide.
  if (kit.padState?.active && kit.profile.pad) return blocked();
  if (kit.time - kit.glideEndedAt < k.pairLockout) return blocked();

  // 5. One hand.
  const gesture = classifyOneHand(kit, p, ray, worldRay, hit);
  if (gesture.kind !== 'blocked') {
    gesture.hand = p.hand;
    gesture.pointerId = p.id;
    kit.gesture = gesture;
  }
  return gesture;
}

/** [R] MetalWalking.swift:201-269; [G] FocusEnvironmentWalking.swift:298-365 */
function classifyOneHand(kit, p, ray, worldRay, hit) {
  const k = kit.k;
  const headWorld = toWorld(kit.rig, kit.head.position);
  const forwardWorld = dirToWorld(kit.rig, kit.head.forward);
  const level = isLevel(hit, k);
  const lookingDown = forwardWorld.y < k.lookingDown || worldRay.dir.y < k.lookingDown;

  if (hit?.kind === 'object' && (kit.flying || !(level && lookingDown))) {
    return { kind: 'object', hit, gripStart: p.grip, since: kit.time, longFired: false };
  }
  if (kit.flying || !kit.profile.teleport) return turnGesture(kit, p, ray, hit);
  if (hit && level && hit.kind !== 'ui') {
    const seen = obstruction(headWorld, hit, kit.cast, k);
    if (seen.kind === 'level') {
      const landed = seen.hit;
      const xz = insideFloors(landed.point, kit.world.floors, k);
      const spot = insideBounds({ x: xz.x, y: landed.point.y, z: xz.z }, kit.world.bounds, k.edgeMargin);
      const valid = canLand(landed, { floorOnly: kit.profile.floorOnly, floorY: kit.floorY(), k });
      return { kind: 'press', spot, yaw: kit.rig.yaw + kit.head.yaw, valid, lifted: false, cancelled: !valid, gripStart: p.grip };
    }
  }
  return turnGesture(kit, p, ray, hit);
}

/** The profile's hand turn: the flick (room), the drag (region), or gevvr's gated drag about a picked point (planet). */
function turnGesture(kit, p, ray, hit) {
  const style = kit.profile.turn;
  // No one-hand meaning, but it may become half of a pair (planet's step flight).
  if (style === 'none') return kit.profile.glide !== 'off' ? { kind: 'idle' } : blocked();
  const heading = handHeadingNow(kit, p, ray);
  if (style === 'flick') return { kind: 'swing', start: heading };
  const planet = kit.profile.name === 'planet';
  return {
    kind: 'drag', last: heading, gripStart: p.grip, since: kit.time,
    gated: planet, clampSample: planet, pivot: planet ? hit?.point ?? null : undefined,
  };
}

/** The hand's heading around the head ([G] head to grip), or the pinch ray's own heading without a grip ([M]). */
function handHeadingNow(kit, p, ray = p.ray) {
  if (p.grip) return headingAround(kit.head.position, p.grip);
  return ray ? headingOf(ray.dir.x, ray.dir.z) : kit.head.yaw;
}

const HANDLERS = {
  idle: {
    end: dropGesture,
    cancel: dropGesture,
  },
  press: {
    hold: steerPress,
    end(kit, o, p) {
      steerPress(kit, o, p);
      kit.gesture = null;
      if (!o.cancelled) kit.teleport(o.spot, o.yaw);
      else if (!o.valid && !o.lifted) kit.notice("Can't land there");
    },
    cancel: dropGesture,
  },
  swing: {
    end(kit, o, p) {
      kit.gesture = null;
      const turn = flickTurn(o.start, handHeadingNow(kit, p), kit.k);
      if (turn) kit.turnBy(turn);
    },
    cancel: dropGesture,
  },
  drag: {
    hold: dragHold,
    end: endDrag,
    cancel: endDrag,
  },
  object: {
    hold(kit, o, p) {
      const moved = o.gripStart && p.grip ? sub(p.grip, o.gripStart) : { x: 0, y: 0, z: 0 };
      if (kit.profile.turn === 'drag' && dragIntended(kit.time - o.since, moved, kit.k)) {
        // Held a beat and dragged: it's a turn after all. [R] MetalWalking.swift:287-294
        Object.assign(o, { kind: 'drag', last: handHeadingNow(kit, p), gated: false, clampSample: kit.profile.name === 'planet' });
      }
    },
    /** Decided on release: held still at least longPress is a long-press (Gridlight sits), else a click. [R] MetalWalking.swift:354-360 */
    end(kit, o) {
      kit.gesture = null;
      if (kit.time - o.since >= kit.k.longPress) kit.select(o.hit, 'long-press');
      else if (o.hit.destination) kit.selectDestination(o.hit.destination);
      else kit.select(o.hit, 'click');
    },
    cancel: dropGesture,
  },
  panel: {
    hold(kit, o, p) {
      if (o.index === null) return;
      if (o.gripStart && p.grip && distance(p.grip, o.gripStart) > kit.k.panelRayMove) o.moved = true;
      if (o.item?.repeat && !o.moved && kit.time - o.since > kit.k.repeatDelay && kit.time - o.lastRepeat >= kit.k.repeatEvery && onCell(kit, p, o.index)) {
        o.lastRepeat = kit.time;
        kit.pressPanel(o.index, { repeat: true });
      }
    },
    end(kit, o, p) {
      if (o.index === null || o.item?.repeat) return;
      if (!o.moved && onCell(kit, p, o.index)) kit.pressPanel(o.index);
    },
  },
  tab: {
    hold(kit, o, p) {
      if (o.gripStart && p.grip && distance(p.grip, o.gripStart) > kit.k.panelRayMove) o.moved = true;
    },
    end(kit, o) {
      if (!o.moved) kit.toggleTab();
    },
  },
  pairMember: {
    end: (kit, o, p) => kit.memberEnded(p.id, true),
    cancel: (kit, o, p) => kit.memberEnded(p.id, false),
  },
};

function dropGesture(kit) {
  kit.gesture = null;
}

/** [M] FloorTeleport.jsx:77-83; the hand's way across the floor in tracking space, turned into the world by the rig. */
function steerPress(kit, o, p) {
  if (!p.grip) return;
  if (!o.gripStart) {
    o.gripStart = p.grip;
    return;
  }
  const d = sub(p.grip, o.gripStart);
  const heading = handHeading(d.x, d.z, Number.NaN, kit.k);
  if (!Number.isNaN(heading)) o.yaw = heading + kit.rig.yaw;
  o.lifted = d.y > kit.k.liftToCancel;
  o.cancelled = !o.valid || o.lifted;
}

function dragHold(kit, o, p) {
  const now = handHeadingNow(kit, p);
  if (o.gated) {
    const moved = o.gripStart && p.grip ? sub(p.grip, o.gripStart) : { x: 0, y: 0, z: 0 };
    if (!dragIntended(kit.time - o.since, moved, kit.k)) {
      o.last = now;
      return;
    }
    o.gated = false;
  }
  const turn = dragTurn(o.last, now, kit.k, { clampSample: o.clampSample });
  o.last = now;
  if (o.pivot === null) return; // planet with nothing picked: no turn [V] StreamedWorld.swift:939
  if (kit.moving || kit.panelBusy) return; // a move under way, or the panel in use, holds the view still
  if (turn) kit.dragTurnBy(turn, o.pivot);
}

function endDrag(kit, o, p) {
  if (p.phase === 'end') dragHold(kit, o, p);
  kit.gesture = null;
  kit.emit({ type: 'turn', committed: true });
}

/** Whether the pinch's ray is still on that cell, on a panel still usable (not faded with a lost hand). [V] StreamedWorld.swift:398, 425 */
function onCell(kit, p, index) {
  const ray = p.ray;
  if (!ray || !kit.wristOut?.usable) return false;
  const hit = kit.wrist.rayHit(ray.origin, ray.dir, true);
  return hit?.target === 'panel' && kit.panel.itemAt(hit.uv)?.index === index;
}
