// The kit: createLocomotion() and its per-frame update(). Pure: no DOM, no WebXR globals, no renderer. The host (or
// src/xr/adapter.js) hands it a tracking-space snapshot each frame and draws what it returns. README.md is the spec.

import { resolveConstants, resolveProfile } from './constants.js';
import {
  add, clamp, clampDt, dirToWorld, distance, finite3, frameMatrix, headFromPose, headSpot, length, makeRig,
  angleBetween, floorWords, nudgeRig, offsetFrom, offsetWords, rigForSpot, rigMatrix, rigsDiffer, scale, smoothstep, toWorld,
  turnRigAbout, turnRigAboutHead, vec,
} from './math.js';
import { destinationSpot, insideBounds, insideFloors, landingFloor, ringHit, stationInFront } from './teleport.js';
import { dashSeconds, easeSpeed, glideVelocity, planetBoost, planetHeight, planetScale, planetSpeed, stepDistance, stepIntent, throttle } from './fly.js';
import { groundFromRaycast, walkStep } from './walk.js';
import { Pad, padVelocity } from './pad.js';
import { JointPinches, pinchOf } from './pinch.js';
import { Curtain, Vignette } from './comfort.js';
import { Wrist } from './wrist.js';
import { Panel } from './panel.js';
import { routePointers } from './arbiter.js';

/**
 * @typedef {import('./math.js').Vec3} Vec3
 * @typedef {import('./math.js').Rig} Rig
 *
 * @typedef {object} PointerInput   one pinch (a select from selectstart to selectend), tracking space
 * @property {number} id
 * @property {'left'|'right'|'none'} hand
 * @property {'start'|'hold'|'end'|'cancel'} phase  end: a completed select; cancel: selectend without select, or lost
 * @property {{origin:Vec3, dir:Vec3}|null} startRay the target ray at selectstart (the gaze on Vision Pro)
 * @property {{origin:Vec3, dir:Vec3}|null} ray      now, or the last known
 * @property {Vec3|null} grip                         the gripSpace position now, or the last known
 *
 * @typedef {object} LocomotionInput  tracking space (the base local-floor reference space)
 * @property {number} time            seconds, monotonic
 * @property {{position:Vec3, orientation:{x,y,z,w}}|null} head
 * @property {PointerInput[]} [pointers]
 * @property {{left?: {joints?: object|null, grip?: object|null, controller?: boolean}|null,
 *             right?: {joints?: object|null, grip?: object|null, controller?: boolean}|null}} [hands]
 * @property {boolean} [handTracking]  the session has hand joints
 * @property {import('./pad.js').PadInput|null} [pad]
 * @property {boolean} [paused]        the session is not visible (blurred or hidden)
 * @property {boolean} [reset]         the base reference space fired 'reset'
 */

const defaultTime = (date) => {
  const h = date.getHours(), m = date.getMinutes();
  return `${h}:${String(m).padStart(2, '0')}`;
};

/**
 * @param {object} options
 * @param {'room'|'region'|'planet'} [options.profile]
 * @param {object} [options.world]   host queries, world space: raycast(origin, dir, max), floors, bounds, ground(x, z, fromY),
 *                                   collide(from, to, {flying}), waterY, canFly(), groundHeight(x, z) (planet)
 * @param {Array<object>} [options.destinations] {id, label, x, y, z, yaw, kind, view?, close?, crossing?}
 * @param {string|object} [options.start]  a destination id or spot, placed once tracking is valid
 * @param {string|object} [options.home]   when no destination has kind 'home'
 * @param {object} [options.hooks]   onMove, onSelect, confirmMove, onPanel, onExit, onNotice, onFly, onKeep
 * @param {object} [options.panel]   {items, place, mount, controllerPalmAxis}
 * @param {object} [options.constants]  overrides of K
 * @param {'blink'|'dash'} [options.teleportTransition]
 * @param {boolean} [options.takeOffByLookUp]  R-RK's look-up take-off (default off, as R-Metal)
 * @param {boolean} [options.followPitch]      R-RK's full-gaze flight instead of R-Metal's level band
 * @param {() => Date} [options.clock]
 * @param {(date: Date) => string} [options.formatTime]
 */
export function createLocomotion(options = {}) {
  const kit = new Kit(options);
  return {
    update: (input) => kit.update(input),
    jump: (target, opts) => kit.jump(target, opts),
    step: (offset) => kit.stepDestinations(offset),
    home: () => kit.home(),
    turn: (angle, opts) => (opts?.instant ? kit.turnInstant(angle) : kit.turnBy(angle)),
    nudge: (n) => kit.nudge(n),
    keepSpot: () => kit.keepSpot(),
    setFlying: (on) => kit.setFlying(on),
    setRig: (rig) => kit.setRig(rig),
    setDestinations: (list) => kit.setDestinations(list),
    notice: (text) => kit.notice(text),
    pause: () => kit.pause(),
    resume: () => kit.resume(),
    resolveMove: (outcome) => kit.curtain.resolve(outcome),
    get rig() { return { ...kit.rig }; },
    get flying() { return kit.flying; },
    get raise() { return kit.raise; },
    get moving() { return kit.moving; },
    get constants() { return kit.k; },
    get profile() { return kit.profile; },
  };
}

class Kit {
  constructor(o) {
    this.k = resolveConstants(o.constants);
    this.profile = resolveProfile(o.profile ?? 'room', o);
    this.world = o.world ?? {};
    this.hooks = o.hooks ?? {};
    this.options = {
      start: o.start ?? null,
      home: o.home ?? null,
      teleportTransition: o.teleportTransition ?? 'blink',
      takeOffByLookUp: !!o.takeOffByLookUp,
      followPitch: !!o.followPitch,
      place: o.panel?.place ?? '',
      clock: o.clock ?? (() => new Date()),
      formatTime: o.formatTime ?? defaultTime,
    };
    this.cast = (origin, dir, max) => this.world.raycast?.(origin, dir, max) ?? null;
    this.ground = this.world.ground ?? (this.world.raycast ? groundFromRaycast(this.cast, this.k) : null);
    this.destinations = (o.destinations ?? []).map((d) => ({ ...d }));
    this.rig = makeRig(o.rig);
    this.flying = this.profile.alwaysFlying;
    this.raise = 0;
    this.last = null;
    this.time = 0;
    this.dt = 0;
    this.started = false;
    this.eyeHeight = null;
    this.head = null;
    this.startSpot = null;
    this.activeDestination = null;
    this.close = false;
    this.curtain = new Curtain();
    this.vignette = new Vignette();
    this.dash = null;
    this.owners = new Map();
    this.pointerById = new Map();
    this.gesture = null;
    this.pair = null;
    this.neutralNeeded = true;
    this.hostPaused = false;
    this.paused = false;
    this.glideEndedAt = -Infinity;
    this.glideSpeed = 0;
    this.surface = null;
    this.landedAt = -Infinity;
    this.lastLand = -Infinity;
    this.landedThisGlide = false;
    this.pad = new Pad();
    this.padState = null;
    this.wrist = new Wrist(this.k, { mount: o.panel?.mount ?? 'auto', palmAxis: o.panel?.controllerPalmAxis });
    this.panel = new Panel({ profile: this.profile.name, items: o.panel?.items, fine: this.profile.fine, destinations: () => this.destinations, k: this.k });
    this.wristOut = null;
    this.pokeHeld = null;
    this.joints = new JointPinches();
    this.jointPinch = { left: null, right: null };
    this.turned = 0;
    this.velocity = vec();
    this.events = [];
    this.queued = [];
    this.updating = false;
    this.heightSaveAt = null;
    this.waitingNoticeAt = -Infinity;
  }

  get moving() {
    return this.curtain.busy || !!this.dash;
  }

  /** The floor the person stands on, in the world: the tracking floor plus Fine position's raise. [G] FocusEnvironmentWalking.swift:359-365 */
  floorY() {
    return this.rig.y + this.raise;
  }

  /** Events raised during update() go out with that frame; those raised between frames (a host call) with the next. */
  emit(event) {
    (this.updating ? this.events : this.queued).push(event);
  }

  /** A selectable host object pinched: a click, or a long still hold. */
  select(hit, kind) {
    this.hooks.onSelect?.(hit.object, kind, hit);
    this.emit({ type: 'select', kind, object: hit.object });
  }

  // ─── The frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** @param {LocomotionInput} input */
  update(input) {
    const k = this.k;
    const time = input.time;
    this.dt = this.last === null ? 0 : clampDt(time - this.last, k.dtMax);
    this.last = time;
    this.time = time;
    this.events = this.queued;
    this.queued = [];
    this.updating = true;
    this.turned = 0;
    this.velocity = vec();
    try {
      const paused = !!input.paused || this.hostPaused;
      if (paused && !this.paused) this.interrupt();
      this.paused = paused;

      const head = input.head && finite3(input.head.position) ? headFromPose(input.head) : null;
      if (!head && this.head) this.interrupt();
      this.head = head;
      if (head) this.lastHead = head;
      if (input.reset) this.emit({ type: 'reset' });
      // Start only from a tracked position (not one the browser emulates after losing tracking).
      if (head && !input.head.emulatedPosition && !this.started && head.position.y > k.trackingMinY) this.placeStart();

      this.padState = this.pad.update(input.pad ?? null, time, k);
      this.handlePad();
      this.handleWrist(input);
      this.handleJoints(input);
      routePointers(this, input.pointers ?? []);
      // Both members ending in one frame: the pair ends once, deliberate only if neither was a cancel. [V] VerifySnapshot.swift:8698-8770
      if (this.pair && this.pair.ending !== undefined) this.endPair(this.pair.ending);
      this.checkNeutral(input);
      this.panelBusy = !!this.wristOut?.hover || [...this.owners.values()].some((o) => o.kind === 'panel' || o.kind === 'tab');
      this.integrate();
      this.stepDash();
      this.stepCurtain();
      if (this.heightSaveAt !== null && time >= this.heightSaveAt) {
        this.heightSaveAt = null;
        this.hooks.onKeep?.({ kind: 'height', raise: this.raise });
        this.emit({ type: 'keep', kind: 'height', raise: this.raise });
      }
      const out = this.output();
      this.lastOutRig = { ...this.rig };
      return out;
    } finally {
      this.updating = false;
    }
  }

  /** Stops everything a pause, a press or lost tracking should stop, and asks for neutral before re-arming (invariant 7). */
  interrupt() {
    this.dropGesture();
    this.endPair(false);
    this.glideSpeed = 0;
    for (const [id, owner] of this.owners) this.owners.set(id, { kind: 'blocked', pointerId: id, pointer: owner.pointer });
    this.neutralNeeded = true;
    this.pad.requireCentre();
  }

  /** The head now, or the last one tracked: a move that completes at full dark while tracking is lost still lands. */
  anyHead() {
    return this.head ?? this.lastHead;
  }

  dropGesture(toPair = []) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.kind === 'drag') this.emit({ type: 'turn', committed: true });
    const id = g.pointerId;
    if (this.owners.has(id)) this.owners.set(id, { kind: toPair.includes(id) ? 'pairMember' : 'blocked', pointerId: id, pointer: g.pointer });
  }

  checkNeutral(input) {
    if (!this.neutralNeeded || this.paused) return;
    const live = (input.pointers ?? []).some((p) => p.phase === 'start' || p.phase === 'hold');
    const padOk = !this.padState || this.padState.centred;
    if (!live && this.joints.open && padOk) this.neutralNeeded = false;
  }

  placeStart() {
    const head = this.head;
    this.started = true;
    this.eyeHeight = head.position.y;
    const start = typeof this.options.start === 'string' ? this.destinations.find((d) => d.id === this.options.start) : this.options.start;
    if (start) {
      const spot = start.kind || start.view !== undefined ? destinationSpot(start) : { y: 0, yaw: 0, ...start };
      this.applyRig(rigForSpot(this.headXZ(), spot, (spot.y ?? 0) - this.raise, this.rig.scale), 'start');
      this.startSpot = { x: spot.x, y: spot.y ?? 0, z: spot.z, yaw: spot.yaw };
      if (start.id) this.activeDestination = start.id;
    } else {
      this.startSpot = headSpot(this.rig, head);
    }
    this.emit({ type: 'start' });
  }

  headXZ() {
    const head = this.anyHead();
    return { x: head.position.x, z: head.position.z, yaw: head.yaw };
  }

  // ─── Controller ─────────────────────────────────────────────────────────────────────────────────────────────

  handlePad() {
    const p = this.padState, k = this.k;
    if (!p) return;
    if (p.exit) {
      this.emit({ type: 'exit', via: 'pad' });
      this.hooks.onExit?.();
    }
    if (this.paused || !this.head) return;
    if (p.active && this.profile.pad && (this.gesture || this.pair)) {
      this.dropGesture();
      this.endPair(false);
    }
    if (p.edges.a && this.profile.fly && !this.profile.alwaysFlying) this.setFlying(!this.flying);
    if (p.edges.y || p.edges.r3) {
      // The origins re-anchor the room under the head here; the kit's world already moves round the person, so
      // only turbo clears. The event lets a host do more. [R] WorldWalking.swift:639-643; [V] Geography.swift:645-656
      this.pad.clearTurbo();
      this.emit({ type: 'recentre' });
    }
    if (p.edges.b) this.emit({ type: 'button', button: 'b' });
    if (p.edges.x) this.emit({ type: 'button', button: 'x' });
    if (p.turn && !this.moving && !this.neutralNeeded) this.applyRig(turnRigAboutHead(this.rig, this.head, p.turn), 'snap');
    if (this.profile.fly && !this.flying && !this.neutralNeeded && p.right.y > k.padTakeOffY && Math.abs(p.rawTurn) < k.padTakeOffMaxX &&
        this.time - this.landedAt > k.takeOffCooldown) {
      this.setFlying(true);
    }
  }

  // ─── The wrist panel ────────────────────────────────────────────────────────────────────────────────────────

  handleWrist(input) {
    const hands = input.hands ?? {};
    const left = hands.left ?? null, right = hands.right ?? null;
    const j = left?.joints;
    const joints = j && finite3(j.wrist) && finite3(j.indexKnuckle) && finite3(j.middleKnuckle) && finite3(j.littleKnuckle) ? j : null;
    this.wristOut = this.wrist.update({
      joints,
      tip: right?.joints?.indexTip ?? null,
      controllerGrip: left?.controller ? left.grip ?? null : null,
      handTracking: !!input.handTracking,
      head: this.head?.position ?? null,
      eyeHeight: this.eyeHeight,
      dt: this.dt,
      time: this.time,
    });
    const poke = this.wristOut.poke;
    if (!poke || this.paused || !this.head) {
      this.pokeHeld = null;
      return;
    }
    const found = this.panel.itemAt(poke.uv);
    if (!found) return; // the header or a gap: stays armed, so sliding onto a button still presses it
    if (poke.began) {
      this.wrist.disarm();
      this.pokeHeld = { index: found.index, since: this.time, last: this.time };
      this.pressPanel(found.index);
    } else if (this.pokeHeld?.index === found.index && found.item.repeat &&
               this.time - this.pokeHeld.since > this.k.repeatDelay && this.time - this.pokeHeld.last >= this.k.repeatEvery) {
      this.pokeHeld.last = this.time;
      this.pressPanel(found.index, { repeat: true });
    }
  }

  /** A press on a panel cell (poke or look-and-pinch). A press stops motion: you're using a hand for it. */
  pressPanel(index, { repeat = false } = {}) {
    const item = this.panel.press(index, this.time, { repeat });
    if (!item) return;
    if (!repeat) {
      this.dropGesture();
      this.endPair(false);
      this.glideSpeed = 0;
      this.neutralNeeded = true; // invariant 7: after the panel, hands open and sticks centred before motion re-arms
    }
    this.panelAction(item);
    if (!item.keepOpen && this.wrist.mount === 'tab' && this.wrist.tabOpen) this.toggleTab();
  }

  panelAction(item) {
    const k = this.k, a = item.action;
    if (a.startsWith('page:')) return this.panel.setPage(a.slice(5));
    if (a.startsWith('jump:')) {
      this.panel.setPage('main');
      return this.jump(a.slice(5));
    }
    const nudges = {
      'nudge:forward': { forward: k.nudgeStep }, 'nudge:back': { forward: -k.nudgeStep },
      'nudge:left': { right: -k.nudgeStep }, 'nudge:right': { right: k.nudgeStep },
      'nudge:turn-left': { turn: k.nudgeTurn }, 'nudge:turn-right': { turn: -k.nudgeTurn },
      raise: { raise: k.raiseStep }, lower: { raise: -k.raiseStep },
    };
    if (nudges[a]) return this.nudge(nudges[a]);
    switch (a) {
      case 'fly': return this.setFlying(!this.flying);
      case 'turn-left': return this.turnInstant(k.wristTurn);
      case 'turn-right': return this.turnInstant(-k.wristTurn);
      case 'home': return this.home();
      case 'keep': return this.keepSpot();
      case 'more': return undefined;
      case 'menu':
        this.emit({ type: 'menu' });
        return this.hooks.onPanel?.('menu');
      case 'exit':
        this.emit({ type: 'exit', via: 'panel' });
        return this.hooks.onExit?.();
      default:
        this.emit({ type: 'panel', action: a });
        return this.hooks.onPanel?.(a);
    }
  }

  toggleTab() {
    if (!this.head) return;
    this.wrist.toggleTab(this.head.position, this.head.forward);
  }

  // ─── The two-hand pair ──────────────────────────────────────────────────────────────────────────────────────

  handleJoints(input) {
    const hands = input.hands ?? {};
    const left = pinchOf(hands.left?.joints), right = pinchOf(hands.right?.joints);
    this.jointPinch = { left, right };
    const allowed = this.profile.glide !== 'off' && !this.paused && !this.moving && !this.neutralNeeded && !!this.head &&
      !this.wristOut?.hover && !(this.profile.pad && this.padState?.active);
    const r = this.joints.update(left, right, { available: !!input.handTracking, allowed }, this.k);
    if (r.phase === 'started') this.startPair('joints', []);
    else if ((r.phase === 'ended' || r.phase === 'cancelled') && this.pair?.joints) this.endPair(r.phase === 'ended');
  }

  /** Starts (or joins) the pair, cancelling a one-hand gesture: a press or swing is dropped, a drag keeps its turn. */
  startPair(source, ids) {
    if (this.pair) {
      if (source === 'joints') this.pair.joints = true;
      for (const id of ids) this.pair.members.add(id);
      return;
    }
    this.dropGesture(ids);
    for (const id of ids) {
      const owner = this.owners.get(id);
      if (owner) this.owners.set(id, { kind: 'pairMember', pointerId: id, pointer: owner.pointer });
    }
    this.pair = {
      joints: source === 'joints', members: new Set(ids), style: this.profile.glide,
      useJoints: null, initialSpan: null, spread: 1, heading: null, intent: 0, last: null, lastSample: this.time, broken: false,
    };
    this.landedThisGlide = false;
    this.emit({ type: 'pair' });
  }

  /** A member's pinch ended; the pair ends after this frame's routing, deliberate only if no member cancelled. */
  memberEnded(id, deliberate) {
    const P = this.pair;
    if (!P?.members.has(id)) return;
    P.ending = P.ending === undefined ? deliberate : P.ending && deliberate;
  }

  /** Ends the pair. Release stops (invariant 5); step flight commits one step only on a deliberate release. */
  endPair(deliberate) {
    const P = this.pair;
    if (!P) return;
    this.pair = null;
    this.glideEndedAt = this.time;
    this.glideSpeed = 0;
    for (const id of P.members) {
      const owner = this.owners.get(id);
      if (owner?.kind === 'pairMember') this.owners.set(id, { kind: 'blocked', pointerId: id, pointer: owner.pointer });
    }
    const commit = P.style === 'step' && deliberate && !P.broken && P.intent !== 0 && P.heading;
    this.emit({ type: 'pair-end', deliberate, step: !!commit });
    if (commit) this.commitStep(P);
  }

  /** The pair's spread this frame, from joints (if it started with them) or from the members' grips. */
  samplePair() {
    const P = this.pair, k = this.k;
    if (P.useJoints === null) P.useJoints = P.joints && !!this.jointPinch.left && !!this.jointPinch.right;
    let a = null, b = null;
    if (P.useJoints) {
      if (this.jointPinch.left && this.jointPinch.right) [a, b] = [this.jointPinch.left.point, this.jointPinch.right.point];
    } else {
      const grips = [...P.members].map((id) => this.pointerById.get(id)?.grip).filter(Boolean);
      if (grips.length >= 2) [a, b] = grips;
    }
    if (a && b) {
      if (P.last && (distance(a, P.last[0]) > k.sampleJump || distance(b, P.last[1]) > k.sampleJump)) P.broken = true;
      P.last = [a, b];
      P.lastSample = this.time;
      const span = distance(a, b);
      // Every sample, not just the first: a span outside 0.02–2 m is a bad reading. [V] StreamedWorld.swift:806, 954
      if (!Number.isFinite(span) || span > k.glideMaxSpan || (P.initialSpan !== null && span < k.glideMinSpan)) return this.endPair(false);
      if (P.initialSpan === null) {
        P.initialSpan = Math.max(span, k.glideMinSpan);
        if (P.style === 'step') P.heading = this.levelHeading();
      }
      P.spread = span / P.initialSpan;
    } else if (this.time - P.lastSample > k.sampleStale) {
      return this.endPair(false);
    }
    if (P.style === 'step') P.intent = stepIntent(P.spread, k);
    return undefined;
  }

  /** The head's level world facing, or its right vector turned a quarter if it looks straight up or down. [V] SW:807-818 */
  levelHeading() {
    const f = dirToWorld(this.rig, this.head.forward);
    const flat = Math.hypot(f.x, f.z);
    if (flat > 1e-4) return { x: f.x / flat, z: f.z / flat };
    const r = dirToWorld(this.rig, this.head.right);
    const rl = Math.hypot(r.x, r.z);
    return rl > 1e-4 ? { x: r.z / rl, z: -r.x / rl } : null;
  }

  /** One step along the captured heading at the same height. [V] Geography.swift:839-870 */
  commitStep(P) {
    const k = this.k;
    if (!this.head) return false;
    const here = headSpot(this.rig, this.head);
    const planet = this.profile.name === 'planet';
    const agl = planet ? this.heightAboveGround(here) : 0;
    const d = stepDistance(planet ? planetScale(agl ?? here.y, k) : this.rig.scale, k) * P.intent;
    const target = insideBounds({ x: here.x + P.heading.x * d, y: here.y, z: here.z + P.heading.z * d }, this.world.bounds, k.edgeMargin);
    if (planet) {
      // At the exact prior height; refused as a whole below the floor there, or below 12 km over unknown terrain.
      // [V] Geography.swift:845-856
      const g = this.world.groundHeight?.(target.x, target.z);
      if (!Number.isFinite(g)) {
        if (here.y < k.planetUnknownFloor) return this.waitForTerrain();
      } else if (here.y < g + k.planetClearance) {
        return false;
      }
      return this.applyRig({ ...this.rig, x: this.rig.x + target.x - here.x, z: this.rig.z + target.z - here.z }, 'step');
    }
    const floor = this.ground ? landingFloor(target, target, this.ground, k) : here.y;
    return this.go(() => rigForSpot(this.headXZ(), { x: target.x, z: target.z, yaw: here.yaw }, floor, this.rig.scale), 'step');
  }

  heightAboveGround(p) {
    const g = this.world.groundHeight?.(p.x, p.z);
    return Number.isFinite(g) ? p.y - g : null;
  }

  waitForTerrain() {
    if (this.time - this.waitingNoticeAt > this.k.noticeSeconds) {
      this.waitingNoticeAt = this.time;
      this.notice('Waiting for terrain');
    }
  }

  // ─── Continuous motion ──────────────────────────────────────────────────────────────────────────────────────

  integrate() {
    const k = this.k;
    if (this.pair) this.samplePair();
    // A move under way, a pause, lost tracking, or the panel in use: nothing moves. [V] StreamedWorld.swift:447
    if (this.moving || this.paused || !this.head || this.panelBusy) {
      this.glideSpeed = 0;
      return;
    }
    const forward = dirToWorld(this.rig, this.head.forward);
    const planet = this.profile.name === 'planet';
    const here = planet ? headSpot(this.rig, this.head) : null;
    // Over unknown terrain, speed scales with altitude itself. [V] Geography.swift:754-755, 875-876
    const agl = planet ? this.heightAboveGround(here) ?? here.y : null;
    let v = vec();
    const P = this.pair;
    if (P && P.style === 'continuous' && P.initialSpan !== null) {
      const t = throttle(P.spread, k);
      if (planet) {
        // [V] Geography.swift:864-882: full head direction, speed from height above ground, boost over the top half.
        this.glideSpeed = easeSpeed(this.glideSpeed, t, this.dt, k);
        const g = this.glideSpeed;
        v = scale(forward, Math.min(k.planetSpeedMax, planetSpeed(agl, k) * Math.abs(g) * planetBoost(g, k)) * Math.sign(g));
      } else {
        if (this.options.takeOffByLookUp && this.profile.fly && !this.flying && t > k.takeOffThrottle && forward.y > k.takeOffPitch &&
            !this.landedThisGlide && this.time - this.landedAt > k.takeOffCooldown) {
          this.setFlying(true);
        }
        const full = this.flying ? k.glideFlySpeed : k.glideWalkSpeed;
        this.glideSpeed = easeSpeed(this.glideSpeed, t * full, this.dt, k);
        v = glideVelocity(forward, this.glideSpeed, { flying: this.flying, followPitch: this.options.followPitch }, k);
      }
    } else {
      this.glideSpeed = 0;
    }
    if (this.padState && this.profile.pad && !this.neutralNeeded) {
      const cruise = planet ? planetSpeed(agl, k) : undefined;
      v = add(v, padVelocity(this.padState, forward, this.flying, k, cruise));
    }
    this.velocity = v;
    if (length(v) > k.moveEpsilon) this.moveBy(scale(v, this.dt), P ? 'glide' : 'pad');
  }

  /** Moves the feet (the head's floor spot) by `step`, over the ground and along walls, and the rig with them. */
  moveBy(step, reason) {
    const k = this.k;
    const feet = toWorld(this.rig, { x: this.head.position.x, y: 0, z: this.head.position.z });
    let next;
    if (this.profile.name === 'planet') {
      const want = add(feet, step);
      const g = this.world.groundHeight?.(want.x, want.z) ?? null;
      const h = planetHeight(want.y, feet.y, Number.isFinite(g) ? g : null, k);
      if (h.waiting) this.waitForTerrain();
      next = h.waiting ? { x: feet.x, y: h.height, z: feet.z } : { x: want.x, y: h.height, z: want.z };
    } else if (this.ground) {
      const r = walkStep(feet, step, { flying: this.flying, dt: this.dt },
        { ground: this.ground, collide: this.world.collide, cast: this.cast, waterY: this.world.waterY }, this.surface ?? feet.y, k);
      if (r.stopped) {
        this.glideSpeed = 0;
        return;
      }
      next = r.feet;
      this.surface = r.surface;
      if (r.landed) this.land();
    } else {
      next = add(feet, this.flying ? step : { x: step.x, y: 0, z: step.z });
    }
    next = insideBounds(next, this.world.bounds, k.edgeMargin);
    const b = this.world.bounds;
    if (b && (Number.isFinite(b.minY) || Number.isFinite(b.maxY))) next = { ...next, y: clamp(next.y, b.minY ?? -Infinity, b.maxY ?? Infinity) };
    this.applyRig({ ...this.rig, x: this.rig.x + next.x - feet.x, y: this.rig.y + next.y - feet.y, z: this.rig.z + next.z - feet.z }, reason);
  }

  /** Coming down close to the ground lands; take-off waits takeOffCooldown after this (not after an explicit Fly off). [R] WorldWalking.swift:598-603 */
  land() {
    if (this.time - this.lastLand < this.k.landDebounce) return;
    this.lastLand = this.time;
    this.landedThisGlide = true;
    this.landedAt = this.time;
    this.setFlying(false);
  }

  setFlying(on) {
    if (this.profile.alwaysFlying) return true;
    if (on) {
      if (!this.profile.fly) return false;
      if (this.world.canFly && !this.world.canFly()) {
        this.notice('No flying here');
        return false;
      }
    }
    if (this.flying === on) return true;
    this.flying = on;
    this.hooks.onFly?.(on);
    this.emit({ type: 'fly', flying: on });
    return true;
  }

  // ─── Discrete moves ─────────────────────────────────────────────────────────────────────────────────────────

  applyRig(rig, reason) {
    this.rig = makeRig(rig);
    // The footing remembered for walking belongs to where the feet were; any other move starts afresh. [R] MetalWalking.swift:779
    if (reason !== 'glide' && reason !== 'pad') this.surface = null;
    this.hooks.onMove?.({ ...this.rig }, reason);
    this.emit({ type: 'move', reason });
  }

  /**
   * A discontinuous move: through the curtain (or a dash for teleports, if chosen), or instant where the profile's
   * jumps are instant. `target` computes the rig at full dark, from the head as it is then. [M] useGalleryNavigation.js:74-85
   */
  go(target, reason, { crossing = false, after = null, instant = this.profile.jumps === 'instant' } = {}) {
    if (this.moving || !this.head) return false;
    if (instant) {
      this.applyRig(target(), reason);
      after?.();
      return true;
    }
    this.glideSpeed = 0;
    if (reason === 'teleport' && this.options.teleportTransition === 'dash') return this.startDash(target(), reason, after);
    return this.curtain.start({ target, reason, crossing, after });
  }

  /** A floor teleport: the head over the spot, facing the arrow. */
  teleport(spot, yaw) {
    const k = this.k;
    const floor = this.profile.floorOnly ? spot.y - this.raise : this.ground ? landingFloor(spot, spot, this.ground, k) : spot.y;
    return this.go(() => rigForSpot(this.headXZ(), { x: spot.x, z: spot.z, yaw }, floor, this.rig.scale), 'teleport', {
      instant: false,
      after: () => {
        // Landing in front of a station makes it the one you're at; elsewhere, you're still "at" the last. [M] useGalleryNavigation.js:125-126
        const index = stationInFront({ x: spot.x, z: spot.z, yaw }, this.destinations, k);
        if (index >= 0) this.activeDestination = this.destinations[index].id;
        this.close = false;
      },
    });
  }

  /** A turn about the head through the curtain (the flick). */
  turnBy(angle) {
    return this.go(() => turnRigAboutHead(this.rig, this.anyHead(), angle), 'turn', { instant: false });
  }

  /** An instant snap about the head (stick and wrist turns). */
  turnInstant(angle) {
    if (this.moving || !this.head) return false;
    this.applyRig(turnRigAboutHead(this.rig, this.head, angle), 'snap');
    return true;
  }

  /** One frame of the drag turn, live: about the head, or about a picked world point (planet). */
  dragTurnBy(angle, pivot) {
    this.applyRig(pivot ? turnRigAbout(this.rig, pivot, angle) : turnRigAboutHead(this.rig, this.head, angle), 'turn');
    this.turned += Math.abs(angle);
  }

  jump(target, { close = false } = {}) {
    const d = typeof target === 'string' ? this.destinations.find((x) => x.id === target) : target;
    if (!d) return false;
    const spot = destinationSpot(d, close);
    const floor = (spot.y ?? 0) - (this.profile.floorOnly ? this.raise : 0);
    return this.go(() => rigForSpot(this.headXZ(), spot, floor, this.rig.scale), 'jump', {
      crossing: !!d.crossing,
      after: () => {
        this.activeDestination = d.id ?? null;
        this.close = close && d.close !== undefined;
        this.flyOrWalkAt(floor, spot);
      },
    });
  }

  /**
   * After a jump: a spot with nothing to stand on within a drop, or over water, leaves you flying; one on the ground
   * walking. Walking can't leave a spot in the air (walkStep stops at drops over maxDrop) or on water, so without this
   * a jump to a viewpoint there left you stuck. Found by the first host, Atlantis: aerial viewpoints, and one on a canal.
   */
  flyOrWalkAt(floor, spot) {
    if (!this.ground || !this.profile.fly) return;
    const k = this.k, under = this.ground(spot.x, spot.z, floor + k.maxStep + k.stepSlack);
    const above = under ? floor - under.y : Infinity;
    if (above > k.maxDrop || under?.water) this.setFlying(true);
    else if (above < k.landingHeight) this.setFlying(false);
  }

  /** Pinching a station: go to it, or step closer to / back from the one you're at. [M] useGalleryNavigation.js:97-105 */
  selectDestination(id) {
    if (this.activeDestination === id) return this.jump(id, { close: !this.close });
    return this.jump(id);
  }

  /** Previous / Next along the destinations (not home or seats), wrapping. [M] useGalleryNavigation.js:110-119 */
  stepDestinations(offset) {
    const list = this.destinations.filter((d) => d.kind !== 'home' && d.kind !== 'seat');
    if (!list.length) return false;
    const from = Math.max(0, list.findIndex((d) => d.id === this.activeDestination));
    return this.jump(list[(from + offset + list.length) % list.length].id);
  }

  home() {
    const d = this.destinations.find((x) => x.kind === 'home') ?? (typeof this.options.home === 'string'
      ? this.destinations.find((x) => x.id === this.options.home) : this.options.home);
    if (!d) {
      this.notice('No home set');
      return false;
    }
    return this.jump(d);
  }

  /** Fine position ([G] FocusEnvironmentWalking.swift:369-376): no curtain, no collision; waits while a move is under way. */
  nudge({ forward = 0, right = 0, turn = 0, raise = 0 } = {}) {
    if (this.moving || !this.head) return false;
    let rig = nudgeRig(this.rig, this.head, { forward, right, turn });
    if (raise) {
      const next = clamp(Math.round((this.raise + raise) * 100) / 100, -this.k.raiseLimit, this.k.raiseLimit);
      rig = { ...rig, y: rig.y - (next - this.raise) };
      this.raise = next;
      this.heightSaveAt = this.time + this.k.heightSaveDelay;
    }
    this.applyRig(rig, 'nudge');
    return true;
  }

  keepSpot() {
    if (!this.head) return null;
    const spot = headSpot(this.rig, this.head);
    this.startSpot = { ...spot };
    const kept = { kind: 'spot', spot: { ...spot, y: spot.y + this.raise }, raise: this.raise };
    this.hooks.onKeep?.(kept);
    this.emit({ type: 'keep', ...kept });
    return kept.spot;
  }

  setRig(rig) {
    this.applyRig({ ...this.rig, ...rig }, 'host');
  }

  setDestinations(list) {
    this.destinations = (list ?? []).map((d) => ({ ...d }));
  }

  notice(text) {
    this.panel.notice(text, this.time);
    this.hooks.onNotice?.(text);
    this.emit({ type: 'notice', text });
  }

  pause() {
    this.hostPaused = true;
  }

  resume() {
    this.hostPaused = false;
    this.neutralNeeded = true;
  }

  // ─── Curtain, dash and the host's confirmation ──────────────────────────────────────────────────────────────

  stepCurtain() {
    const r = this.curtain.step(this.dt, this.time, this.k);
    if (r.apply) {
      const m = this.curtain.move;
      m.from = { ...this.rig };
      this.applyRig(m.target(), m.reason);
      // The move's bookkeeping (the station you're at) waits for the host's answer; a refusal leaves none behind.
      if (!this.confirm(m)) m.after?.();
    }
    if (r.confirmed) r.confirmed.after?.();
    if (r.revert) {
      this.applyRig(r.revert.from, 'revert');
      this.notice("Couldn't go there");
    }
    if (r.landed) this.applyRig({ ...this.rig, ...r.rig }, 'landed');
    if (r.timedOut) {
      r.timedOut.after?.();
      this.emit({ type: 'confirm-timeout', reason: r.timedOut.reason });
    }
    if (r.done) this.emit({ type: 'moved', reason: r.done.reason });
  }

  /**
   * Asks the host to confirm a move made at full dark; a promise holds the dark up to confirmHold (+crossingHold).
   * Returns true while an answer is still to come, or the move was refused or redirected (the curtain reports which).
   * [R] AppModel.swift:784-788
   */
  confirm(m) {
    const hook = this.hooks.confirmMove;
    if (!hook) return false;
    let crossing = !!m.crossing;
    const result = hook({ ...this.rig }, { reason: m.reason, from: { ...m.from }, crossing: () => { crossing = true; this.curtain.extend(this.k.crossingHold); } });
    if (!result || typeof result.then !== 'function') {
      if (result === false || (result && typeof result === 'object')) {
        this.curtain.hold(Infinity);
        this.curtain.resolve(result);
        return true;
      }
      return false;
    }
    this.curtain.hold(this.time + this.k.confirmHold + (crossing ? this.k.crossingHold : 0));
    result.then(
      (value) => { if (this.curtain.move === m) this.curtain.resolve(value === undefined ? true : value); },
      () => { if (this.curtain.move === m) this.curtain.resolve(false); },
    );
    return true;
  }

  /** The smooth teleport option: carried there over dashSeconds, turning to face the arrow on the way. [R-Metal] MetalWalking.swift:745-769 */
  startDash(to, reason, after) {
    const from = { ...this.rig };
    this.dash = { from, to, start: this.time, seconds: dashSeconds(distance(from, to), this.k), reason, after, turned: 0 };
    return true;
  }

  stepDash() {
    const d = this.dash;
    if (!d) return;
    const t = Math.min((this.time - d.start) / d.seconds, 1);
    const e = smoothstep(t);
    const turn = angleBetween(d.from.yaw, d.to.yaw);
    const yaw = d.from.yaw + turn * e;
    this.turned += Math.abs(turn * e - d.turned);
    d.turned = turn * e;
    this.applyRig({ ...d.from, x: d.from.x + (d.to.x - d.from.x) * e, y: d.from.y + (d.to.y - d.from.y) * e, z: d.from.z + (d.to.z - d.from.z) * e, yaw }, 'dash');
    if (t >= 1) {
      this.dash = null;
      d.after?.();
      const result = this.hooks.confirmMove?.({ ...this.rig }, { reason: d.reason, from: { ...d.from }, crossing: () => {} });
      // A refusal goes back through the curtain, or at once if another move has started meanwhile; never silently.
      const refuse = () => {
        if (!this.go(() => d.from, 'revert', { instant: false })) this.applyRig(d.from, 'revert');
        this.notice("Couldn't go there");
      };
      if (result === false) refuse();
      else if (result && typeof result.then === 'function') result.then((v) => { if (v === false) refuse(); }, refuse);
    }
  }

  // ─── Output ─────────────────────────────────────────────────────────────────────────────────────────────────

  output() {
    const k = this.k, rig = this.rig, head = this.head;
    let ring = null;
    if (this.profile.teleport && !this.flying && !this.gesture && !this.pair && !this.moving && !this.paused && head && !this.panelBusy) {
      const hit = ringHit(toWorld(rig, head.position), dirToWorld(rig, head.forward), this.cast,
        { floorOnly: this.profile.floorOnly, floorY: this.floorY(), reach: this.profile.reach, k });
      if (hit) {
        // Clamped where a press would land: inside the floor areas, clear of walls and edges. [M] FloorTeleport.jsx:58
        const xz = insideFloors(hit.point, this.world.floors, k);
        const p = insideBounds({ x: xz.x, y: hit.point.y, z: xz.z }, this.world.bounds, k.edgeMargin);
        ring = { x: p.x, y: p.y + k.ringLift, z: p.z };
      }
    }
    const g = this.gesture;
    const target = g?.kind === 'press' ? { x: g.spot.x, y: g.spot.y + k.targetLift, z: g.spot.z, yaw: g.yaw, valid: !g.cancelled } : null;

    const w = this.wristOut;
    let panel = null;
    if (w?.frame && w.shown > 0.01) {
      const place = typeof this.options.place === 'function' ? this.options.place() : this.options.place;
      const readout = this.profile.fine && head && this.startSpot ? this.readout() : null;
      const { face, key } = this.panel.face({ time: this.time, place, clock: this.options.formatTime(this.options.clock()), flying: this.flying, readout });
      panel = {
        matrix: frameMatrix(rig, w.frame), width: w.frame.width, height: w.frame.height,
        shown: w.shown, usable: w.usable, mount: w.mount, face, faceKey: key,
      };
    }
    const tab = w?.tab ? { matrix: frameMatrix(rig, w.tab), width: w.tab.width, height: w.tab.height, open: this.wrist.tabOpen } : null;

    const speed = length(this.velocity);
    const vignette = this.vignette.update(this.dt, { turned: this.turned, speed, dashing: !!this.dash }, k);
    let mode = 'idle';
    if (this.paused) mode = 'paused';
    else if (this.moving) mode = 'moving';
    else if (this.pair) mode = this.pair.style === 'step' ? 'step' : 'glide';
    else if (g) mode = g.kind;
    else if (ring) mode = 'aim';

    return {
      rig: { ...rig },
      rigChanged: rigsDiffer(rig, this.lastOutRig ?? rig),
      rigMatrix: rigMatrix(rig),
      head: head ? { ...toWorld(rig, head.position), yaw: rig.yaw + head.yaw, pitch: head.pitch } : null,
      mode,
      flying: this.flying,
      moving: this.moving,
      paused: this.paused,
      ring,
      target,
      curtain: this.curtain.level,
      vignette,
      panel,
      tab,
      step: this.pair?.style === 'step' ? { intent: this.pair.intent } : null,
      readout: this.profile.fine && head && this.startSpot ? this.readout() : null,
      activeDestination: this.activeDestination,
      events: this.events,
    };
  }

  /** "6 cm ahead, 4 cm right, turned 1° left" and the room's height. [G] FocusEnvironmentNudgeView.swift:141-159 */
  readout() {
    const here = headSpot(this.rig, this.head);
    return `${offsetWords(offsetFrom(this.startSpot, here))} · ${floorWords(this.raise)}`;
  }
}
