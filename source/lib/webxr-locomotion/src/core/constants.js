// Every number the kit uses, with where it came from. Tags follow README.md: [M] Mirador XR, [G] Glass spaces,
// [R] Gridlight (Glass Reality; R-Metal and R-RK for its two render paths), [V] gevvr, [Inferred] no source ran it.
// Paths in SOURCE are relative to each project's root, as listed in SOURCES.md.

const DEG = Math.PI / 180;

/** The numbers. Metres, seconds, radians unless a name says otherwise. */
export const K = Object.freeze({
  // Frame
  dtMax: 0.05,
  trackingMinY: 0.3,
  defaultEyeHeight: 1.6,

  // Teleport
  lookingDown: -0.35,
  reachRoom: 20,
  reachRegion: 60,
  deadZone: 0.03,
  liftToCancel: 0.12,
  levelEnough: 0.6,
  floorTolerance: 0.12,
  obstructionSlack: 0.05,
  obstructionMin: 0.01,
  wallMargin: 0.15,
  edgeMargin: 0.5,
  footingRange: 0.6,
  stationReach: 1,
  stationMaxAngle: Math.PI / 3,
  ringInner: 0.2,
  ringOuter: 0.24,
  ringAlpha: 0.7,
  ringLift: 0.004,
  targetRadius: 0.32,
  targetAlpha: 0.5,
  targetLift: 0.006,
  arrowLift: 0.002,

  // Turn
  flickAngle: 8 * DEG,
  snapTurn: Math.PI / 4,
  stickTurn: Math.PI / 6,
  stickFire: 0.6,
  stickRearm: 0.3,
  wristTurn: Math.PI / 6,
  dragGain: 0.6,
  dragIntentDistance: 0.025,
  dragIntentDelay: 0.12,
  planetTurnClamp: 0.12,
  longPress: 0.9,

  // Curtain and confirm
  fadeSeconds: 0.15,
  confirmHold: 4,
  crossingHold: 12,

  // Glide (two-hand)
  glideNeutralHigh: 1.08,
  glideFull: 2.0,
  glideNeutralLow: 0.92,
  glideFullBack: 0.5,
  glideEase: 8,
  glideMinSpan: 0.02,
  glideMaxSpan: 2,
  glideWalkSpeed: 6,
  glideFlySpeed: 24,
  flyLevelBand: 15 * DEG,
  flyClimb: 4,
  takeOffThrottle: 0.05,
  takeOffPitch: 0.5,
  takeOffCooldown: 1.5,
  landingHeight: 1.5,
  landDebounce: 1,
  pairLockout: 0.4,
  sampleStale: 0.5,
  sampleJump: 0.3,

  // Step flight
  stepUp: 1.14,
  stepDown: 0.86,
  stepGain: 0.28,
  stepMin: 4,
  stepMax: 100,

  // Joint pinches
  pinchClose: 0.026,
  pinchOpen: 0.04,
  pinchMaxGap: 0.2,

  // Planet helpers (flat local frame)
  planetSpeedGain: 0.8,
  planetSpeedMin: 100,
  planetSpeedMax: 4e6,
  planetBoost: 7,
  planetClearance: 100,
  planetUnknownFloor: 12000,
  planetCeiling: 32e6,
  planetScaleMin: 80,
  planetScaleDivisor: 1.2,

  // Walking and walls
  groundFollowRate: 15,
  maxStep: 0.6,
  stepSlack: 0.05,
  maxDrop: 2,
  waterMargin: 0.3,
  footClamp: 0.15,
  bodyRadius: 0.3,
  groundDepth: 200,
  moveEpsilon: 0.02,

  // Controller
  padDeadZone: 0.24,
  padWalkSpeed: 3,
  padFlySpeed: 6,
  padBoost: 4,
  padTurbo: 8,
  padBoostThreshold: 0.5,
  padTakeOffY: 0.5,
  padTakeOffMaxX: 0.4,
  menuHold: 1,

  // Wrist panel
  panelWidth: 0.12,
  panelHeight: 0.08,
  panelPixelsWide: 600,
  panelPixelsHigh: 400,
  wristBack: 0.055,
  wristSkin: 0.03,
  wristClearance: 0.02,
  wristArmHalfWidth: 0.03,
  wristShow: 0.55,
  wristHide: 0.35,
  wristReach: 0.8,
  wristToggleHold: 0.2,
  wristGrace: 0.3,
  wristFade: 6,
  wristUsable: 0.5,
  oneEuroMinCutoff: 1.5,
  oneEuroBeta: 12,
  oneEuroDerivativeCutoff: 1,
  pokeFront: 0.012,
  pokeBack: 0.03,
  pokeRearm: 0.025,
  pokeHoverFront: 0.04,
  panelRayReach: 2,
  panelRayMove: 0.04,
  pressInterval: 0.6,
  litSeconds: 0.25,
  noticeSeconds: 6,
  panelHeader: 0.24,
  panelGap: 0.03,
  repeatDelay: 0.4,
  repeatEvery: 0.15,
  tabX: 0.5,
  tabBelowEye: 0.6,
  tabZ: -0.4,
  tabWidth: 0.16,
  tabHeight: 0.06,
  tabPanelDistance: 0.6,
  tabPanelBelowEye: 0.28,
  tabPanelTilt: 0.35,
  tabPanelScale: 3,

  // Fine position
  nudgeStep: 0.02,
  nudgeTurn: DEG,
  raiseStep: 0.01,
  raiseLimit: 5,
  heightSaveDelay: 1,

  // Vignette and dash
  vignetteClearStill: 1.2,
  vignetteClearFull: 0.3,
  vignetteBand: 0.22,
  vignetteGate: 0.05,
  vignetteFullTurnRate: 0.9,
  vignetteMoveSpeed: 6,
  vignetteMoveShare: 0.45,
  vignetteDash: 0.5,
  vignetteRise: 12,
  vignetteFall: 4,
  dashBase: 0.25,
  dashSpeed: 30,
  dashLongest: 0.9,

  // Host pointer pairing (scene pointer events beside session select events)
  samePinchMs: 150,
});

/** Where each number came from. Every key of K has an entry; constants.test.js checks it. */
export const SOURCE = Object.freeze({
  dtMax: '[V] Geography.swift:622; [R-RK] WorldWalking.swift:541 (R-Metal clamps 0.1)',
  trackingMinY: '[M] src/xr/hooks/useGalleryNavigation.js:58',
  defaultEyeHeight: '[G] FocusEnvironmentArt.swift:61; [R] WorldWalking.swift:818',

  lookingDown: '[M] FloorTeleport.jsx:9; [G] FocusRoomFit.swift:212; [R] WorldWalking.swift:51',
  reachRoom: '[M] floorTarget.js:8; [G] FocusRoomFit.swift:222',
  reachRegion: '[R] WorldWalking.swift:60',
  deadZone: '[M] floorTarget.js:47; [G] FocusRoomFit.swift:216',
  liftToCancel: '[M] FloorTeleport.jsx:11; [G] FocusRoomFit.swift:214',
  levelEnough: '[G] FocusRoomFit.swift:224; [R] WorldWalking.swift:62',
  floorTolerance: '[G] FocusRoomFit.swift:226',
  obstructionSlack: '[G] FocusEnvironmentWalking.swift:342-357; [R] WorldWalking.swift:497-503',
  obstructionMin: '[G] FocusEnvironmentWalking.swift:342-357',
  wallMargin: '[M] floorTarget.js:2',
  edgeMargin: '[R] WorldWalking.swift:147 (used at AppModel.swift:629-640)',
  footingRange: '[R] MetalWalking.swift:405-411 (maxStep)',
  stationReach: '[M] teleport.js:39',
  stationMaxAngle: '[M] teleport.js:39',
  ringInner: '[M] FloorTeleport.jsx:102',
  ringOuter: '[M] FloorTeleport.jsx:102',
  ringAlpha: '[M] FloorTeleport.jsx:103',
  ringLift: '[M] FloorTeleport.jsx:59',
  targetRadius: '[M] FloorTeleport.jsx:107',
  targetAlpha: '[M] FloorTeleport.jsx:112',
  targetLift: '[M] FloorTeleport.jsx:71',
  arrowLift: '[M] FloorTeleport.jsx:120',

  flickAngle: '[M] GalleryRooms.jsx:36; [G] FocusRoomFit.swift:218',
  snapTurn: '[M] GalleryRooms.jsx:34; [G] FocusRoomFit.swift:219',
  stickTurn: '[R] MetalWalking.swift:1133-1141; [V] Geography.swift:679-683',
  stickFire: '[R] MetalWalking.swift:1133; [V] cesiumXR.js:527-542',
  stickRearm: '[R] MetalWalking.swift:1141; [V] cesiumXR.js:527-542',
  wristTurn: '[R] MetalSpace.swift:63-70',
  dragGain: '[R] WorldWalking.swift:79 (was 1.5, PLAN.md:132)',
  dragIntentDistance: '[R] WorldWalking.swift:82; [V] StreamedWorld.swift:937',
  dragIntentDelay: '[R] WorldWalking.swift:83; [V] StreamedWorld.swift:937',
  planetTurnClamp: '[V] StreamedWorld.swift:941',
  longPress: '[R] WorldWalking.swift:85 (sitHold)',

  fadeSeconds: '[M] FadeCurtain.jsx:6; [G] FocusRoomFit.swift:220; [R] WorldWalking.swift:58',
  confirmHold: '[R] AppModel.swift:784-788',
  crossingHold: '[R] AppModel.swift:785-786',

  glideNeutralHigh: '[R] WorldWalking.swift:65; [V] StreamedWorld.swift:760',
  glideFull: '[R] WorldWalking.swift:67; [V] StreamedWorld.swift:760',
  glideNeutralLow: '[R] WorldWalking.swift:69; [V] StreamedWorld.swift:761',
  glideFullBack: '[R] WorldWalking.swift:70; [V] StreamedWorld.swift:761',
  glideEase: '[R] MetalWalking.swift:710; [V] StreamedWorld.swift:957',
  glideMinSpan: '[R] MetalWalking.swift:204-213; [V] StreamedWorld.swift:806',
  glideMaxSpan: '[V] StreamedWorld.swift:806',
  glideWalkSpeed: '[R] WorldWalking.swift:90',
  glideFlySpeed: '[R] WorldWalking.swift:91',
  flyLevelBand: '[R-Metal] WorldWalking.swift:113, MetalWalking.swift:715-725',
  flyClimb: '[R-Metal] WorldWalking.swift:114, MetalWalking.swift:715-725',
  takeOffThrottle: '[R-RK] WorldWalking.swift:549',
  takeOffPitch: '[R-RK] WorldWalking.swift:72',
  takeOffCooldown: '[R] WorldWalking.swift:76; MetalWalking.swift:1170',
  landingHeight: '[R] WorldWalking.swift:74',
  landDebounce: '[R-Metal] MetalWalking.swift:1293-1299',
  pairLockout: '[R] WorldWalking.swift:397-399; MetalWalking.swift:216',
  sampleStale: '[V] StreamedWorld.swift:829',
  sampleJump: '[V] StreamedWorld.swift:845-866',

  stepUp: '[V] StreamedWorld.swift:823',
  stepDown: '[V] StreamedWorld.swift:823',
  stepGain: '[V] Geography.swift:843',
  stepMin: '[V] Geography.swift:843',
  stepMax: '[V] Geography.swift:843',

  pinchClose: '[V] StreamedWorld.swift:480-481',
  pinchOpen: '[V] StreamedWorld.swift:480-481',
  pinchMaxGap: '[V] StreamedWorld.swift:476',

  planetSpeedGain: '[V] Geography.swift:876',
  planetSpeedMin: '[V] Geography.swift:876',
  planetSpeedMax: '[V] Geography.swift:876',
  planetBoost: '[V] Geography.swift:878-880',
  planetClearance: '[V] Geography.swift:404, 627',
  planetUnknownFloor: '[V] Geography.swift:243',
  planetCeiling: '[V] Geography.swift:244',
  planetScaleMin: '[V] Geography.swift:1057',
  planetScaleDivisor: '[V] Geography.swift:1057',

  groundFollowRate: '[R] WorldWalking.swift:89',
  maxStep: '[R] WorldWalking.swift:93',
  stepSlack: '[R] MetalWalking.swift:815 (maxStep + 0.05)',
  maxDrop: '[R] WorldWalking.swift:98',
  waterMargin: '[R] MetalWalking.swift:815',
  footClamp: '[R] MetalWalking.swift:821',
  bodyRadius: '[R] WorldWalking.swift:95',
  groundDepth: '[R] MetalWalking.swift:803; WorldWalking.swift:671-678',
  moveEpsilon: '[R] MetalWalking.swift:770',

  padDeadZone: '[R] WorldWalking.swift:170-178 (raised from [V] 0.15)',
  padWalkSpeed: '[R] WorldWalking.swift:137',
  padFlySpeed: '[R] WorldWalking.swift:138',
  padBoost: '[R] MetalWalking.swift:1156; [V] Geography.swift:731',
  padTurbo: '[R] MetalWalking.swift:1156; [V] Geography.swift:731',
  padBoostThreshold: '[R] MetalWalking.swift:1156; [V] math.js:226',
  padTakeOffY: '[R] MetalWalking.swift:1170',
  padTakeOffMaxX: '[R] MetalWalking.swift:1170',
  menuHold: '[R] MetalWalking.swift:1146-1155; [V] cesiumXR.js:641-645',

  panelWidth: '[R] MetalWrist.swift:50; [V] StreamedWorld.swift:304',
  panelHeight: '[R] MetalWrist.swift:50; [V] StreamedWorld.swift:304',
  panelPixelsWide: '[R] MetalWrist.swift:51',
  panelPixelsHigh: '[R] MetalWrist.swift:51',
  wristBack: '[R] MetalWrist.swift:56',
  wristSkin: '[R] MetalWrist.swift:57',
  wristClearance: '[R] MetalWrist.swift:58',
  wristArmHalfWidth: '[R] MetalWrist.swift:60',
  wristShow: '[R] MetalWrist.swift:154',
  wristHide: '[R] MetalWrist.swift:154',
  wristReach: '[R] MetalWrist.swift:154',
  wristToggleHold: '[R] MetalWrist.swift:64',
  wristGrace: '[R] MetalWrist.swift:62',
  wristFade: '[R] MetalWrist.swift:159',
  wristUsable: '[R] MetalWrist.swift:163',
  oneEuroMinCutoff: '[R] MetalWrist.swift:80',
  oneEuroBeta: '[R] MetalWrist.swift:80',
  oneEuroDerivativeCutoff: '[R] MetalWrist.swift:331',
  pokeFront: '[R] MetalWrist.swift:167; [V] StreamedWorld.swift:437',
  pokeBack: '[R] MetalWrist.swift:167; [V] StreamedWorld.swift:437',
  pokeRearm: '[R] MetalWrist.swift:172; [V] StreamedWorld.swift:439',
  pokeHoverFront: '[V] StreamedWorld.swift:436',
  panelRayReach: '[R] MetalWrist.swift:235; [V] StreamedWorld.swift:334-344',
  panelRayMove: '[V] StreamedWorld.swift:419',
  pressInterval: '[R] MetalWrist.swift:200; [V] StreamedWorld.swift:442',
  litSeconds: '[R] MetalWrist.swift:196; [V] StreamedWorld.swift:442',
  noticeSeconds: '[R] AppModel.swift:963',
  panelHeader: '[R] MetalWrist.swift:103',
  panelGap: '[R] MetalWrist.swift:103',
  repeatDelay: '[Inferred] repeat-while-held for Fine position cells ([G] buttonRepeatBehavior)',
  repeatEvery: '[Inferred] repeat-while-held for Fine position cells ([G] buttonRepeatBehavior)',
  tabX: '[M] GalleryScene.jsx:38',
  tabBelowEye: '[M] GalleryScene.jsx:38',
  tabZ: '[M] GalleryScene.jsx:38',
  tabWidth: '[Inferred] tab size',
  tabHeight: '[Inferred] tab size',
  tabPanelDistance: '[M] GalleryScene.jsx:40',
  tabPanelBelowEye: '[M] GalleryScene.jsx:40',
  tabPanelTilt: '[M] GalleryScene.jsx:40',
  tabPanelScale: '[Inferred] the wrist face scaled up for reading at 0.6 m',

  nudgeStep: '[G] FocusRoomFit.swift:266',
  nudgeTurn: '[G] FocusRoomFit.swift:267',
  raiseStep: '[G] FocusRoomFit.swift:77-87',
  raiseLimit: '[G] FocusRoomFit.swift:77-87',
  heightSaveDelay: '[G] FocusEnvironmentNudgeView.swift:116-136',

  vignetteClearStill: '[R-Metal] Shaders.metal:943',
  vignetteClearFull: '[R-Metal] Shaders.metal:943',
  vignetteBand: '[R-Metal] Shaders.metal:944',
  vignetteGate: '[R-Metal] Shaders.metal:944',
  vignetteFullTurnRate: '[R] WorldWalking.swift:87',
  vignetteMoveSpeed: '[R-Metal] MetalWalking.swift:968 (glideWalkSpeed)',
  vignetteMoveShare: '[R-Metal] MetalWalking.swift:969',
  vignetteDash: '[R-Metal] MetalWalking.swift:969',
  vignetteRise: '[R-Metal] MetalWalking.swift:970',
  vignetteFall: '[R-Metal] MetalWalking.swift:970',
  dashBase: '[R-Metal] WorldWalking.swift:104',
  dashSpeed: '[R-Metal] WorldWalking.swift:105',
  dashLongest: '[R-Metal] WorldWalking.swift:106',

  samePinchMs: '[M] usePinchHand.js:7',
});

/**
 * What each profile switches on. Behaviour options, not numbers; a host may override any of them.
 * - teleport: floor teleport and its ring
 * - fly: whether flying exists; planet is always flying
 * - turn: the hand turn ('flick', 'drag', 'none')
 * - glide: the two-hand pair ('off', 'continuous', 'step')
 * - jumps: how a jump or step moves ('curtain', 'instant')
 * - floorOnly: land only within floorTolerance of the floor you stand on [G]
 * - fine: Fine position on the panel
 * - pad: whether the sticks move you (stick snaps work everywhere)
 */
export const PROFILES = Object.freeze({
  room: Object.freeze({
    teleport: true, fly: false, alwaysFlying: false, turn: 'flick', glide: 'off', jumps: 'curtain',
    floorOnly: true, fine: true, pad: false, reach: K.reachRoom,
  }),
  region: Object.freeze({
    teleport: true, fly: true, alwaysFlying: false, turn: 'drag', glide: 'continuous', jumps: 'curtain',
    floorOnly: false, fine: false, pad: true, reach: K.reachRegion,
  }),
  planet: Object.freeze({
    teleport: false, fly: true, alwaysFlying: true, turn: 'none', glide: 'step', jumps: 'instant',
    floorOnly: false, fine: false, pad: true, reach: K.reachRegion,
  }),
});

/** The numbers with a host's overrides applied. Unknown keys throw, so a typo never silently does nothing. */
export function resolveConstants(overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!(key in K)) throw new Error(`webxr-locomotion: unknown constant "${key}"`);
    if (typeof overrides[key] !== 'number' || !Number.isFinite(overrides[key])) {
      throw new Error(`webxr-locomotion: constant "${key}" must be a finite number`);
    }
  }
  return Object.freeze({ ...K, ...overrides });
}

/** A profile's behaviour with a host's option overrides applied. */
export function resolveProfile(name, options = {}) {
  const base = PROFILES[name];
  if (!base) throw new Error(`webxr-locomotion: unknown profile "${name}" (room, region or planet)`);
  const profile = { ...base };
  for (const key of ['teleport', 'fly', 'turn', 'glide', 'jumps', 'floorOnly', 'fine', 'pad', 'reach']) {
    if (options[key] !== undefined) profile[key] = options[key];
  }
  // gevvr's one-hand turn (about the picked point) exists only in its continuous flight style. [V] StreamedWorld.swift:931-947
  if (name === 'planet' && profile.glide === 'continuous' && options.turn === undefined) profile.turn = 'drag';
  if (!['flick', 'drag', 'none'].includes(profile.turn)) throw new Error(`webxr-locomotion: turn must be flick, drag or none`);
  if (!['off', 'continuous', 'step'].includes(profile.glide)) throw new Error(`webxr-locomotion: glide must be off, continuous or step`);
  if (!['curtain', 'instant'].includes(profile.jumps)) throw new Error(`webxr-locomotion: jumps must be curtain or instant`);
  profile.name = name;
  return Object.freeze(profile);
}
