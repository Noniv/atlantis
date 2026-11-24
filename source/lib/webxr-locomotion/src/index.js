// webxr-locomotion: the pure core. The WebXR adapter is in ./xr, renderer-neutral visuals in ./visuals.
export { createLocomotion } from './core/locomotion.js';
export { K, SOURCE, PROFILES, resolveConstants, resolveProfile } from './core/constants.js';
export * as math from './core/math.js';
export { canLand, handHeading, obstruction, insideFloors, insideBounds, stationInFront, viewingSpot, destinationSpot } from './core/teleport.js';
export { flickTurn, dragTurn, headingAround, StickSnap } from './core/turn.js';
export { throttle, glideVelocity, stepIntent, stepDistance, planetSpeed, planetBoost, planetScale, planetHeight, dashSeconds } from './core/fly.js';
export { walkStep, slideMove, groundFromRaycast } from './core/walk.js';
export { Pad, readStandardPad, readXRStandardPads, radialDeadZone, padVelocity } from './core/pad.js';
export { JointPinches, pinchOf } from './core/pinch.js';
export { Curtain, Vignette, vignetteParams, overlayAlpha } from './core/comfort.js';
export { Wrist, rayOnFrame } from './core/wrist.js';
export { Panel, ITEMS, MAIN, layoutCells, cellAtUV } from './core/panel.js';
