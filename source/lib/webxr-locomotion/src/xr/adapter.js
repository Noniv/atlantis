// The WebXR adapter: an XRSession and its frames in, the kit's tracking-space snapshot out, and the rig applied as an
// offset reference space for rendering (README.md § Coordinates and maths → Applying the rig).
//
// Pitfalls it handles:
// - Pinches come only from the session's select events, keyed by XRInputSource, never by index: under hand tracking,
//   Vision Pro lists the two tracked hands first and transient pinches after them.
// - `event.frame` is valid only during dispatch, so selectstart's ray and grip are read there and then.
// - `select` before `selectend` marks a completed pinch (phase 'end'); `selectend` alone, or a source removed while
//   pressed, is a cancel. A start and an end between two frames come out over two frames, so a quick tap is not lost.
// - Hand movement is the gripSpace, not the target ray: on Vision Pro the ray pivots between the eyes. [M] usePinchHand.js

import { readStandardPad, readXRStandardPads } from '../core/pad.js';
import { rigsDiffer, rotate, yawQuat } from '../core/math.js';
import { K } from '../core/constants.js';

const BASE_JOINTS = Object.freeze({
  wrist: 'wrist',
  indexKnuckle: 'index-finger-phalanx-proximal',
  middleKnuckle: 'middle-finger-phalanx-proximal',
  littleKnuckle: 'pinky-finger-phalanx-proximal',
});
const TIP_JOINTS = Object.freeze({ thumbTip: 'thumb-tip', indexTip: 'index-finger-tip' });

const point = (p) => ({ x: p.x, y: p.y, z: p.z });
const quat = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

function rayOf(pose) {
  if (!pose) return null;
  const t = pose.transform;
  return { origin: point(t.position), dir: rotate(quat(t.orientation), { x: 0, y: 0, z: -1 }) };
}

function defaultGetGamepads() {
  try {
    return globalThis.navigator?.getGamepads?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * @param {XRSession} session
 * @param {object} options
 * @param {XRReferenceSpace} options.baseSpace  the session's 'local-floor' space; every pose is read in it
 * @param {() => (Gamepad|null)[]} [options.getGamepads]  default navigator.getGamepads
 * @param {typeof XRRigidTransform} [options.RigidTransform] default globalThis.XRRigidTransform
 * @param {() => number} [options.now] milliseconds, for pairPointerEvent only
 */
export function createXRInput(session, { baseSpace, getGamepads = defaultGetGamepads, RigidTransform = globalThis.XRRigidTransform, now = () => globalThis.performance?.now?.() ?? Date.now(), samePinchMs = K.samePinchMs } = {}) {
  if (!session) throw new Error('webxr-locomotion: createXRInput needs an XRSession');
  if (!baseSpace) throw new Error("webxr-locomotion: createXRInput needs baseSpace (the 'local-floor' reference space)");

  const records = new Map();
  let nextId = 1;
  let paused = session.visibilityState ? session.visibilityState !== 'visible' : false;
  let resetFlag = false;
  let cached = null;
  let warnedScale = false;
  let lastSelect = null;
  let waiting = null;

  const record = (source) => {
    let r = records.get(source);
    if (!r) {
      r = { source, pinches: [], ray: null, grip: null, sampledAt: -Infinity, removed: false };
      records.set(source, r);
    }
    return r;
  };
  const poseIn = (frame, space) => {
    if (!frame || !space) return null;
    try {
      return frame.getPose(space, baseSpace) ?? null;
    } catch {
      return null;
    }
  };
  const openPinch = (r) => r.pinches.find((p) => !p.ended);

  const onSelectStart = (event) => {
    const source = event.inputSource;
    const r = record(source);
    const pinch = { id: nextId++, queue: ['start'], completed: false, ended: false, startRay: null };
    const ray = rayOf(poseIn(event.frame, source.targetRaySpace));
    const grip = poseIn(event.frame, source.gripSpace);
    if (ray) pinch.startRay = r.ray = ray;
    if (grip) r.grip = point(grip.transform.position);
    r.pinches.push(pinch);
    lastSelect = { at: now(), source };
    // A pointer event that came first takes this pinch's hand, however late it is. [M] usePinchHand.js:38-39
    if (waiting) {
      const callback = waiting;
      waiting = null;
      callback(source);
    }
  };
  // Never re-create a record here: a late event for a deleted source must not leave one polled for ever.
  const onSelect = (event) => {
    const r = records.get(event.inputSource);
    const p = r && openPinch(r);
    if (p) p.completed = true;
  };
  const onSelectEnd = (event) => {
    const r = records.get(event.inputSource);
    const p = r && openPinch(r);
    if (!p) return;
    p.ended = true;
    p.queue.push(p.completed ? 'end' : 'cancel');
  };
  const onSourcesChange = (event) => {
    for (const source of event.removed ?? []) {
      const r = records.get(source);
      if (!r) continue;
      r.removed = true;
      for (const p of r.pinches) {
        if (!p.ended) {
          p.ended = true;
          p.queue.push('cancel');
        }
      }
    }
  };
  const onVisibility = () => {
    paused = session.visibilityState !== 'visible';
  };
  const onReset = () => {
    resetFlag = true;
    cached = null;
  };

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('select', onSelect);
  session.addEventListener('selectend', onSelectEnd);
  session.addEventListener('inputsourceschange', onSourcesChange);
  session.addEventListener('visibilitychange', onVisibility);
  baseSpace.addEventListener?.('reset', onReset);

  function readJoints(frame, hand) {
    const joint = (name, tracked) => {
      const space = hand.get?.(name);
      if (!space || !frame.getJointPose) return null;
      let pose = null;
      try {
        pose = frame.getJointPose(space, baseSpace);
      } catch {
        pose = null;
      }
      if (!pose) return null;
      // Base joints may be estimated; fingertips must be tracked. [V] build 85, activeContext.md:10-12
      if (tracked && pose.emulatedPosition) return null;
      return point(pose.transform.position);
    };
    const joints = {};
    for (const [key, name] of Object.entries(BASE_JOINTS)) joints[key] = joint(name, false);
    for (const [key, name] of Object.entries(TIP_JOINTS)) joints[key] = joint(name, true);
    return joints;
  }

  /**
   * The snapshot for one frame.
   * @param {XRFrame} frame
   * @param {number} t the rAF time in milliseconds
   */
  function read(frame, t) {
    const time = t / 1000;
    let viewer = null;
    try {
      viewer = frame.getViewerPose(baseSpace);
    } catch {
      viewer = null;
    }
    const head = viewer
      ? { position: point(viewer.transform.position), orientation: quat(viewer.transform.orientation), emulatedPosition: !!viewer.emulatedPosition }
      : null;

    const pointers = [];
    for (const r of [...records.values()]) {
      if (!r.removed) {
        const ray = rayOf(poseIn(frame, r.source.targetRaySpace));
        const grip = poseIn(frame, r.source.gripSpace);
        if (ray) r.ray = ray;
        if (grip) r.grip = point(grip.transform.position);
        if (ray || grip) r.sampledAt = time;
      }
      for (const p of r.pinches) {
        const phase = p.queue.length ? p.queue.shift() : 'hold';
        pointers.push({
          id: p.id,
          hand: r.source.handedness === 'left' || r.source.handedness === 'right' ? r.source.handedness : 'none',
          mode: r.source.targetRayMode,
          controller: r.source.targetRayMode === 'tracked-pointer' && !r.source.hand,
          phase,
          startRay: p.startRay ?? r.ray,
          ray: r.ray,
          grip: r.grip,
          sampledAt: r.sampledAt,
        });
        if (phase === 'end' || phase === 'cancel') p.done = true;
      }
      r.pinches = r.pinches.filter((p) => !p.done);
      if (r.removed && !r.pinches.length) records.delete(r.source);
    }

    const hands = { left: null, right: null };
    const controllers = { left: null, right: null };
    let handTracking = Array.isArray(session.enabledFeatures) && session.enabledFeatures.includes('hand-tracking');
    for (const source of session.inputSources ?? []) {
      const side = source.handedness;
      if (side !== 'left' && side !== 'right') continue;
      if (source.hand) {
        handTracking = true;
        hands[side] = { joints: readJoints(frame, source.hand), grip: null, controller: false };
      } else if (source.targetRayMode === 'tracked-pointer') {
        controllers[side] = source;
        if (!hands[side]) {
          const g = poseIn(frame, source.gripSpace);
          hands[side] = { joints: null, grip: g ? { position: point(g.transform.position), orientation: quat(g.transform.orientation) } : null, controller: true };
        }
      }
    }

    let pad = null;
    for (const g of getGamepads() ?? []) {
      pad = readStandardPad(g);
      if (pad) break;
    }
    if (!pad) pad = readXRStandardPads(controllers.left?.gamepad ?? null, controllers.right?.gamepad ?? null);

    const reset = resetFlag;
    resetFlag = false;
    return { time, head, pointers, hands, handTracking, pad, paused, reset };
  }

  /**
   * The reference space to render the world in, for this rig: base.getOffsetReferenceSpace(rig⁻¹), made only when the
   * rig changes. Poses read in it come out in world coordinates. XRRigidTransform cannot carry scale: with
   * rig.scale ≠ 1 compose out.rigMatrix into the view yourself.
   */
  function apply(rig) {
    if (cached && !rigsDiffer(cached.rig, rig)) return cached.space;
    if (!RigidTransform) throw new Error('webxr-locomotion: XRRigidTransform is not available');
    if ((rig.scale ?? 1) !== 1 && !warnedScale) {
      warnedScale = true;
      console.warn('webxr-locomotion: rig.scale is not 1; the offset reference space ignores it. Compose out.rigMatrix yourself.');
    }
    const transform = new RigidTransform({ x: rig.x, y: rig.y, z: rig.z, w: 1 }, yawQuat(rig.yaw));
    const space = baseSpace.getOffsetReferenceSpace(transform.inverse);
    cached = { rig: { x: rig.x, y: rig.y, z: rig.z, yaw: rig.yaw, scale: rig.scale ?? 1 }, space };
    return space;
  }

  /**
   * For hosts that also use scene pointer events (three.js, R3F): calls back with the XRInputSource behind a pointer
   * event. Its selectstart may come just before the pointer event (up to samePinchMs) or after it, in which case the
   * next selectstart is taken; only the latest waiting pointer event is kept. [M] usePinchHand.js:36-40, 75-79
   */
  function pairPointerEvent(callback) {
    if (lastSelect && now() - lastSelect.at < samePinchMs) callback(lastSelect.source);
    else waiting = callback;
  }

  function dispose() {
    session.removeEventListener('selectstart', onSelectStart);
    session.removeEventListener('select', onSelect);
    session.removeEventListener('selectend', onSelectEnd);
    session.removeEventListener('inputsourceschange', onSourcesChange);
    session.removeEventListener('visibilitychange', onVisibility);
    baseSpace.removeEventListener?.('reset', onReset);
    records.clear();
    cached = null;
    waiting = null;
  }

  return {
    read,
    apply,
    pairPointerEvent,
    dispose,
    get referenceSpace() {
      return cached?.space ?? baseSpace;
    },
  };
}
