// Where the panel is and whether it shows (README.md § Wrist panel). Tracking space throughout, so a teleport never
// smears the filter. Three mounts:
// - 'hand': worn inside the left wrist, shown when that palm turns toward you. Port of [R] MetalWrist.swift:place.
// - 'controller': on the left controller's grip, same facing test. *Inferred.*
// - 'tab': no hands and no controller (transient pinches only): a tab low on the right that opens the panel ahead,
//   after [M] GalleryScene.jsx:38-40 (the search button and panel). *Inferred as a panel mount.*

import { add, cross, dot, length, normalize, OneEuro, rotate, scale, sub } from './math.js';

const UP = { x: 0, y: 1, z: 0 };

/** A frame facing `toward` from `at`, upright: +Z toward it, up = world up made orthogonal. [R] MetalWrist.swift:axes */
function facingFrame(at, toward, fallbackUp) {
  const toHead = sub(toward, at);
  const z = scale(toHead, 1 / Math.max(length(toHead), 1e-3));
  let up = sub(UP, scale(z, z.y));
  up = length(up) > 1e-3 ? normalize(up) : fallbackUp;
  return { x: cross(up, z), up, z };
}

/** A panel-plane frame from its centre and axes, as a plain object. */
const frame = (centre, axes, width, height) => ({ centre, x: axes.x, up: axes.up, z: axes.z, width, height });

/** Where a ray meets a frame's face, as face units (0…1 across, 0…1 down), within `reach`; front side only. [R] MetalWrist.swift:button(along:direction:) */
export function rayOnFrame(origin, direction, f, reach) {
  if (!f) return null;
  const facing = dot(direction, f.z);
  if (!(facing < -1e-3)) return null;
  const t = dot(sub(f.centre, origin), f.z) / facing;
  if (!(t > 0 && t < reach)) return null;
  const local = sub(add(origin, scale(direction, t)), f.centre);
  const ax = dot(local, f.x), ay = dot(local, f.up);
  if (Math.abs(ax) >= f.width / 2 || Math.abs(ay) >= f.height / 2) return null;
  return { x: ax / f.width + 0.5, y: 0.5 - ay / f.height };
}

export class Wrist {
  constructor(k, { mount = 'auto', palmAxis = { x: 1, y: 0, z: 0 } } = {}) {
    this.k = k;
    this.mountOption = mount;
    this.palmAxis = palmAxis;
    this.filter = new OneEuro(k.oneEuroMinCutoff, k.oneEuroBeta, k.oneEuroDerivativeCutoff);
    this.shown = 0;
    this.visible = false;
    this.lastTracked = -Infinity;
    this.lastToggle = -Infinity;
    this.armed = true;
    this.placement = null;
    this.mount = null;
    this.seen = { hand: -Infinity, controller: -Infinity };
    this.tab = null;
    this.tabOpen = false;
    this.tabPanel = null;
  }

  /**
   * Which mount applies this frame: the hand if its joints are here, else a controller's grip, else the mount in use
   * while its source is within its grace (a dropped frame must not reset the panel), else the hand if the session
   * tracks hands (they're just out of view), else the tab. Quest grants hand tracking to people holding controllers,
   * so `handTracking` alone never picks the hand.
   */
  chooseMount({ joints, handTracking, controllerGrip, time }) {
    if (joints) this.seen.hand = time;
    if (controllerGrip) this.seen.controller = time;
    if (this.mountOption !== 'auto') return this.mountOption;
    if (joints) return 'hand';
    if (controllerGrip) return 'controller';
    if ((this.mount === 'hand' || this.mount === 'controller') && time - this.seen[this.mount] <= this.k.wristGrace + 1 / this.k.wristFade) {
      return this.mount;
    }
    if (handTracking) return 'hand';
    return 'tab';
  }

  /** The poke pressed a cell: no more presses until the fingertip leaves the face (or backs off 2.5 cm). */
  disarm() {
    this.armed = false;
  }

  /**
   * @param {object} s
   * @param {{wrist, indexKnuckle, middleKnuckle, littleKnuckle}|null} s.joints left hand, tracking space
   * @param {{x,y,z}|null} s.tip right index fingertip (tracked only)
   * @param {{position, orientation}|null} s.controllerGrip left controller grip
   * @param {boolean} s.handTracking
   * @param {{x,y,z}|null} s.head head position, tracking space
   * @param {number} s.eyeHeight
   * @param {number} s.dt
   * @param {number} s.time
   * @returns {{mount, frame, tab, shown, usable, hover, poke: null|{uv, began}}}
   */
  update(s) {
    const mount = this.chooseMount(s);
    if (mount !== this.mount) {
      this.mount = mount;
      this.shown = 0;
      this.visible = false;
      this.filter.reset();
      this.placement = null;
      this.tabOpen = false;
    }
    let poke = null;
    let hover = false;
    if (mount === 'hand') ({ poke, hover } = this.updateHand(s));
    else if (mount === 'controller') this.updateController(s);
    else this.updateTab(s);
    const usable = this.shown > this.k.wristUsable && !!this.placement;
    return { mount, frame: this.placement, tab: mount === 'tab' ? this.tab : null, shown: this.shown, usable, hover, poke };
  }

  fade(dt) {
    this.shown = this.visible ? Math.min(1, this.shown + dt * this.k.wristFade) : Math.max(0, this.shown - dt * this.k.wristFade);
  }

  toggle(wanted, time) {
    if (wanted !== this.visible && time - this.lastToggle > this.k.wristToggleHold) {
      this.visible = wanted;
      this.lastToggle = time;
    }
  }

  /** [R] MetalWrist.swift:place(_:head:dt:), with [V]'s hover band (StreamedWorld.swift:436). */
  updateHand({ joints: j, tip, head, dt, time }) {
    const k = this.k;
    if (!j || !head) {
      if (time - this.lastTracked > k.wristGrace) {
        this.visible = false;
        this.fade(dt);
        this.filter.reset();
      }
      return { poke: null, hover: false };
    }
    this.lastTracked = time;
    const palm = normalize(cross(sub(j.littleKnuckle, j.wrist), sub(j.indexKnuckle, j.wrist)), null);
    const elbow = normalize(sub(j.wrist, j.middleKnuckle), null);
    if (!palm || !elbow) return { poke: null, hover: false };
    let centre = add(add(j.wrist, scale(elbow, k.wristBack)), scale(palm, k.wristSkin + k.wristClearance));
    const tilted = facingFrame(centre, head, elbow);
    const facing = dot(palm, tilted.z);
    centre = add(centre, scale(palm, Math.abs(dot(tilted.x, palm)) * (k.panelWidth / 2) + Math.abs(dot(tilted.up, palm)) * k.wristArmHalfWidth));
    centre = this.filter.filter(centre, dt);
    const axes = facingFrame(centre, head, elbow);
    const away = length(sub(head, centre));
    this.toggle(away < k.wristReach && facing > (this.visible ? k.wristHide : k.wristShow), time);
    this.fade(dt);
    this.placement = frame(centre, axes, k.panelWidth, k.panelHeight);

    let poke = null;
    let hover = false;
    if (tip && this.shown > k.wristUsable) {
      const local = sub(tip, centre);
      const ax = dot(local, axes.x), ay = dot(local, axes.up), az = dot(local, axes.z);
      const onFace = Math.abs(ax) < k.panelWidth / 2 && Math.abs(ay) < k.panelHeight / 2;
      hover = onFace && az >= -k.pokeBack && az <= k.pokeHoverFront;
      if (onFace && az < k.pokeFront && az > -k.pokeBack) {
        // Armed until the caller presses a cell (disarm()): touching the header or a gap first, then sliding onto a
        // button, still presses it. [R] MetalWrist.swift:168; [V] StreamedWorld.swift:438
        poke = { uv: { x: ax / k.panelWidth + 0.5, y: 0.5 - ay / k.panelHeight }, began: this.armed };
      } else if (!onFace || az > k.pokeRearm) {
        this.armed = true;
      }
    } else {
      this.armed = true;
    }
    return { poke, hover };
  }

  /** *Inferred:* the left grip's palm axis (+X by default) plays the palm; press by ray only. */
  updateController({ controllerGrip: g, head, dt, time }) {
    const k = this.k;
    if (!g || !head) {
      if (time - this.lastTracked > k.wristGrace) {
        this.visible = false;
        this.fade(dt);
      }
      return;
    }
    this.lastTracked = time;
    const palm = normalize(rotate(g.orientation, this.palmAxis), UP);
    const centre = this.filter.filter(add(g.position, scale(palm, k.wristSkin + k.wristClearance)), dt);
    const axes = facingFrame(centre, head, rotate(g.orientation, { x: 0, y: 0, z: -1 }));
    const facing = dot(palm, axes.z);
    const away = length(sub(head, centre));
    this.toggle(away < k.wristReach && facing > (this.visible ? k.wristHide : k.wristShow), time);
    this.fade(dt);
    this.placement = frame(centre, axes, k.panelWidth, k.panelHeight);
  }

  /**
   * The tab, fixed in tracking space low on the right at the eye height first measured (clamped 1.0–1.75 m as [M]
   * useGalleryNavigation.js:11-12, 59 does); hidden while its panel is open ([M] GalleryScene.jsx:256). Open, the
   * panel stands ahead of where the head was, in tracking space (so it travels with the person).
   */
  updateTab({ head, eyeHeight, dt }) {
    const k = this.k;
    if (!head) return;
    const eye = Math.min(1.75, Math.max(1, eyeHeight ?? k.defaultEyeHeight));
    const at = { x: k.tabX, y: eye - k.tabBelowEye, z: k.tabZ };
    this.tab = this.tabOpen ? null : frame(at, facingFrame(at, head, UP), k.tabWidth, k.tabHeight);
    this.eye = eye;
    this.visible = this.tabOpen;
    this.fade(dt);
    this.placement = this.tabOpen ? this.tabPanel : null;
    if (!this.tabOpen) this.shown = 0;
  }

  /** Opens or closes the tab's panel, standing it tabPanelDistance ahead, below the eyes, tilted up toward them. */
  toggleTab(head, forward) {
    const k = this.k;
    this.tabOpen = !this.tabOpen;
    if (!this.tabOpen) {
      this.placement = null;
      this.shown = 0;
      return;
    }
    const flat = normalize({ x: forward.x, y: 0, z: forward.z }, { x: 0, y: 0, z: -1 });
    const eye = this.eye ?? Math.min(1.75, Math.max(1, head.y));
    const centre = { x: head.x + flat.x * k.tabPanelDistance, y: eye - k.tabPanelBelowEye, z: head.z + flat.z * k.tabPanelDistance };
    // Facing back along `flat`, then tilted up by tabPanelTilt about its own x.
    const z0 = scale(flat, -1);
    const x = cross(UP, z0);
    const c = Math.cos(k.tabPanelTilt), s = Math.sin(k.tabPanelTilt);
    const up = add(scale(UP, c), scale(z0, -s));
    const z = add(scale(z0, c), scale(UP, s));
    this.tabPanel = frame(centre, { x, up, z }, k.panelWidth * k.tabPanelScale, k.panelHeight * k.tabPanelScale);
    this.placement = this.tabPanel;
    this.visible = true;
    this.shown = 1;
  }

  /** Where a tracking-space ray meets the panel or the tab. */
  rayHit(origin, direction, usable) {
    const reach = this.k.panelRayReach;
    if (usable) {
      const uv = rayOnFrame(origin, direction, this.placement, reach);
      if (uv) return { target: 'panel', uv };
    }
    if (this.mount === 'tab' && this.tab && rayOnFrame(origin, direction, this.tab, reach)) return { target: 'tab' };
    return null;
  }
}
