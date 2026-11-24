// dev-xr.html only: a headset on the desktop. It stands in for navigator.xr and XRGPUBinding as Safari on Apple Vision
// Pro offers them, so xr.js and the locomotion kit run in Chrome: two eyes with off-centre frustums, side by side on the
// canvas, and a head, transient pinches and tracked hands scripted from window.__xrsim. Never part of xr.html.
// ?xrw=, ?xrh=: an eye's pixels; ?xrlayout=sbs: both eyes in one texture (else a two-layer array); ?xrsrgb: an sRGB
// format; ?xrroll=: the eyes rolled (radians), to check the renderer's camera.
{
  const P = new URLSearchParams(location.search), EW = +P.get('xrw') || 800, EH = +P.get('xrh') || 800, SBS = P.get('xrlayout') === 'sbs', ROLL = +P.get('xrroll') || 0;
  // rigid transforms {p, q}; comp(a, b) applies b, then a
  const v3 = (x, y, z) => ({ x, y, z });
  const qm = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
  const qr = (q, v) => {
    const cx = q.y * v.z - q.z * v.y + q.w * v.x, cy = q.z * v.x - q.x * v.z + q.w * v.y, cz = q.x * v.y - q.y * v.x + q.w * v.z;
    return v3(v.x + 2 * (q.y * cz - q.z * cy), v.y + 2 * (q.z * cx - q.x * cz), v.z + 2 * (q.x * cy - q.y * cx));
  };
  const comp = (a, b) => { const r = qr(a.q, b.p); return { p: v3(a.p.x + r.x, a.p.y + r.y, a.p.z + r.z), q: qm(a.q, b.q) }; };
  const inv = (a) => { const q = { x: -a.q.x, y: -a.q.y, z: -a.q.z, w: a.q.w }, r = qr(q, a.p); return { p: v3(-r.x, -r.y, -r.z), q }; };
  const axis = (x, y, z, a) => ({ x: x * Math.sin(a / 2), y: y * Math.sin(a / 2), z: z * Math.sin(a / 2), w: Math.cos(a / 2) });
  const look = (yaw, pitch, roll = 0) => qm(qm(axis(0, 1, 0, yaw), axis(1, 0, 0, pitch)), axis(0, 0, 1, roll)); // yaw + turns left
  // the rotation taking -z to d (a ray's orientation)
  // (1 + a.d, a x d) normalised, with a = (0, 0, -1): a x d = (y, -x, 0)
  const aim = (d) => {
    const l = Math.hypot(d.x, d.y, d.z), x = d.x / l, y = d.y / l, w = 1 - d.z / l;
    if (w < 1e-6) return { x: 0, y: 1, z: 0, w: 0 };
    const n = Math.hypot(y, x, w);
    return { x: y / n, y: -x / n, z: 0, w: w / n };
  };
  const mat = (t) => {
    const { x, y, z, w } = t.q, m = new Float32Array(16);
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + w * z); m[2] = 2 * (x * z - w * y);
    m[4] = 2 * (x * y - w * z); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + w * x);
    m[8] = 2 * (x * z + w * y); m[9] = 2 * (y * z - w * x); m[10] = 1 - 2 * (x * x + y * y);
    m[12] = t.p.x; m[13] = t.p.y; m[14] = t.p.z; m[15] = 1;
    return m;
  };
  const xform = (t) => ({ position: { ...t.p, w: 1 }, orientation: { ...t.q }, matrix: mat(t) });
  const fromXR = (t) => ({ p: v3(t.position.x, t.position.y, t.position.z), q: { x: t.orientation.x, y: t.orientation.y, z: t.orientation.z, w: t.orientation.w } });
  const ID = { p: v3(0, 0, 0), q: { x: 0, y: 0, z: 0, w: 1 } };
  // Vision Pro-like eyes: 64 mm apart, frustums wider on the outside; GL-style projections (near 0.1, far 1000)
  const EYES = [{ eye: 'left', dx: -0.032, t: [-1.05, 0.85, -1.0, 0.9] }, { eye: 'right', dx: 0.032, t: [-0.85, 1.05, -1.0, 0.9] }];
  for (const e of EYES) {
    const [l, r, b, t] = e.t, n = 0.1, f = 1000, m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[8] = (r + l) / (r - l); m[9] = (t + b) / (t - b); m[10] = -(f + n) / (f - n); m[11] = -1; m[14] = -2 * f * n / (f - n);
    e.proj = m;
  }

  const sim = { head: { p: v3(0, 1.6, 0), q: look(0, -0.3) }, session: null, frame: 0, waits: [], shots: [], space: null };
  class Space extends EventTarget {
    constructor(o) { super(); this.o = o; }
    getOffsetReferenceSpace(t) { return new Space(comp(this.o, fromXR(t))); }
  }
  class Frame {
    constructor(s) { this.session = s; this.active = true; }
    check() { if (!this.active) throw new DOMException('XRFrame is not active', 'InvalidStateError'); }
    getViewerPose(space) {
      this.check(); sim.space = space;
      const w = inv(space.o), head = comp(w, sim.head);
      const views = EYES.map((e) => ({ eye: e.eye, projectionMatrix: e.proj, transform: xform(comp(head, { p: v3(e.dx, 0, 0), q: ROLL ? axis(0, 0, 1, ROLL) : ID.q })) }));
      return { transform: xform(head), views, emulatedPosition: false };
    }
    getPose(space, base) { this.check(); const t = space.pose(); return t ? { transform: xform(comp(inv(base.o), t)), emulatedPosition: false } : null; }
    getJointPose(joint, base) { this.check(); const t = joint.pose(); return t ? { transform: xform(comp(inv(base.o), t)), radius: 0.008, emulatedPosition: false } : null; }
  }
  const poseSpace = (pose) => ({ pose });
  // a transient pinch (Vision Pro): its target ray is the gaze at the pinch, then follows the hand
  function transient(side, dir, grip) {
    const src = { handedness: side, targetRayMode: 'transient-pointer', profiles: [], hand: null, gamepad: null, dir, grip, from: grip };
    src.targetRaySpace = poseSpace(() => ({ p: { ...sim.head.p }, q: aim(src.dir) }));
    src.gripSpace = poseSpace(() => ({ p: { ...src.grip }, q: ID.q }));
    return src;
  }
  // tracked hands: joints as the kit reads them
  const JOINTS = ['wrist', 'index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal', 'thumb-tip', 'index-finger-tip'];
  function trackedHand(side) {
    const at = {}, hand = new Map(JOINTS.map((n) => [n, poseSpace(() => (at[n] ? { p: { ...at[n] }, q: ID.q } : null))]));
    return { handedness: side, targetRayMode: 'tracked-pointer', profiles: [], gamepad: null, hand, at,
      targetRaySpace: poseSpace(() => (at.wrist ? { p: { ...at.wrist }, q: ID.q } : null)), gripSpace: poseSpace(() => (at.wrist ? { p: { ...at.wrist }, q: ID.q } : null)) };
  }

  class Session extends EventTarget {
    constructor(features) {
      super(); this.enabledFeatures = features; this.inputSources = []; this.visibilityState = 'visible'; this.frameRate = 90;
      this.cbs = []; this.queue = []; this.ended = false; this.layer = null; this.raf = requestAnimationFrame((t) => this.tick(t));
    }
    updateRenderState(s) { if (s.layers) this.layer = s.layers[0]; }
    requestReferenceSpace(type) { return type === 'local-floor' || type === 'local' ? Promise.resolve(new Space(ID)) : Promise.reject(new DOMException(type, 'NotSupportedError')); }
    requestAnimationFrame(cb) { this.cbs.push(cb); return this.cbs.length; }
    cancelAnimationFrame() {}
    end() { if (this.ended) return Promise.resolve(); this.ended = true; cancelAnimationFrame(this.raf); sim.session = null; this.dispatchEvent(new Event('end')); return Promise.resolve(); }
    fire(type, extra) { const f = new Frame(this), e = Object.assign(new Event(type), { frame: f, ...extra }); this.dispatchEvent(e); f.active = false; }
    tick(t) {
      if (this.ended) return;
      this.raf = requestAnimationFrame((t2) => this.tick(t2));
      // input events land before the frame's callbacks, as in a browser
      for (const q of this.queue.splice(0)) q();
      const cbs = this.cbs.splice(0), f = new Frame(this);
      for (const cb of cbs) cb(t, f);
      f.active = false;
      if (this.layer && cbs.length) present(this.layer);
      sim.frame++;
      for (const w of sim.waits.splice(0)) if (sim.frame >= w.at) w.done(); else sim.waits.push(w);
    }
  }
  // both eyes onto the canvas, side by side
  function present(layer) {
    const c = ctx.getCurrentTexture(), e = device.createCommandEncoder();
    if (SBS) e.copyTextureToTexture({ texture: layer.tex }, { texture: c }, [EW * 2, EH, 1]);
    else for (let i = 0; i < 2; i++) e.copyTextureToTexture({ texture: layer.tex, origin: [0, 0, i] }, { texture: c, origin: [i * EW, 0, 0] }, [EW, EH, 1]);
    device.queue.submit([e.finish()]);
    for (const s of sim.shots.splice(0)) s(canvas.toDataURL('image/png'));
  }
  class GPUBinding {
    constructor(session, dev) { this.session = session; this.device = dev; }
    getPreferredColorFormat() { return FMT + (P.has('xrsrgb') ? '-srgb' : ''); }
    createProjectionLayer({ colorFormat, depthStencilFormat }) {
      const size = SBS ? [EW * 2, EH, 1] : [EW, EH, 2];
      const tex = this.device.createTexture({ size, format: colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
      const depth = depthStencilFormat ? this.device.createTexture({ size, format: depthStencilFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
      canvas.width = EW * 2; canvas.height = EH;
      ctx.configure({ device: this.device, format: FMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST, alphaMode: 'opaque' });
      return { tex, depth, textureWidth: SBS ? EW * 2 : EW, textureHeight: EH, textureArrayLength: SBS ? 1 : 2, ignoreDepthValues: !depth };
    }
    getViewSubImage(layer, view) {
      const i = view.eye === 'right' ? 1 : 0;
      return SBS ? { colorTexture: layer.tex, depthStencilTexture: layer.depth, viewport: { x: i * EW, y: 0, width: EW, height: EH }, getViewDescriptor: () => ({ dimension: '2d' }) }
        : { colorTexture: layer.tex, depthStencilTexture: layer.depth, viewport: { x: 0, y: 0, width: EW, height: EH }, getViewDescriptor: () => ({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }) };
    }
  }
  const SUPPORTED = ['local-floor', 'local', 'webgpu', 'hand-tracking', 'layers'];
  const xr = {
    isSessionSupported: (mode) => Promise.resolve(mode === 'immersive-vr'),
    requestSession(mode, init = {}) {
      const missing = (init.requiredFeatures ?? []).filter((f) => !SUPPORTED.includes(f));
      if (mode !== 'immersive-vr' || missing.length || sim.session) return Promise.reject(new DOMException('not supported: ' + missing, 'NotSupportedError'));
      const features = [...(init.requiredFeatures ?? []), ...(init.optionalFeatures ?? []).filter((f) => SUPPORTED.includes(f))];
      return Promise.resolve((sim.session = new Session(features)));
    },
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  window.XRGPUBinding = GPUBinding;

  // ── the script: world points go through the rig the scene last drew with ──
  const toTracking = (w) => (sim.space ? comp(sim.space.o, { p: v3(w.x, w.y, w.z), q: ID.q }).p : v3(w.x, w.y, w.z));
  const later = (fn) => sim.session.queue.push(fn);
  const pinches = {};
  window.__xrsim = {
    // start a session as the Enter VR button does, and wait for it to draw
    async enter() { document.getElementById('x').click(); for (let i = 0; i < 200 && !(sim.session && sim.frame > 3); i++) await new Promise((r) => setTimeout(r, 50)); return !!sim.session; },
    frames: (n = 1) => new Promise((done) => sim.waits.push({ at: sim.frame + n, done })),
    // the head in tracking space (local-floor): position, yaw (+ left), pitch (+ up), roll
    head({ x = sim.head.p.x, y = sim.head.p.y, z = sim.head.p.z, yaw = 0, pitch = 0, roll = 0 } = {}) { sim.head = { p: v3(x, y, z), q: look(yaw, pitch, roll) }; },
    // a pinch while looking at a world point (Vision Pro: the gaze picks, the hand moves)
    pinch(side, world, grip = { x: side === 'left' ? -0.2 : 0.2, y: sim.head.p.y - 0.45, z: sim.head.p.z - 0.3 }) {
      const t = toTracking(world), h = sim.head.p, src = transient(side, v3(t.x - h.x, t.y - h.y, t.z - h.z), { ...grip });
      pinches[side] = src;
      later(() => { sim.session.inputSources = [...sim.session.inputSources, src]; sim.session.fire('inputsourceschange', { added: [src], removed: [] }); sim.session.fire('selectstart', { inputSource: src }); });
    },
    // the pinching hand moves (tracking space, relative to where it started)
    drag(side, d) { const s = pinches[side]; s.grip = v3(s.from.x + d.x, s.from.y + d.y, s.from.z + d.z); },
    release(side, completed = true) {
      const src = pinches[side]; delete pinches[side];
      later(() => {
        if (completed) sim.session.fire('select', { inputSource: src });
        sim.session.fire('selectend', { inputSource: src });
        sim.session.inputSources = sim.session.inputSources.filter((s) => s !== src); sim.session.fire('inputsourceschange', { added: [], removed: [src] });
      });
    },
    // tracked hands (hand-tracking granted): joints in tracking space. palm(side, wrist) faces the palm to the head
    hands(on = true) {
      const now = sim.session.inputSources.filter((s) => !s.hand);
      sim.hands = on ? { left: trackedHand('left'), right: trackedHand('right') } : null;
      const added = on ? [sim.hands.left, sim.hands.right] : [], removed = sim.session.inputSources.filter((s) => s.hand);
      later(() => { sim.session.inputSources = [...now, ...added]; sim.session.fire('inputsourceschange', { added, removed }); });
    },
    palm(side, wrist) {
      const h = sim.head.p, a = sim.hands[side].at, n0 = v3(h.x - wrist.x, h.y - wrist.y, h.z - wrist.z), ln = Math.hypot(n0.x, n0.y, n0.z), n = v3(n0.x / ln, n0.y / ln, n0.z / ln);
      let f = v3(n.z, 0, -n.x); const lf = Math.hypot(f.x, f.z) || 1; f = v3(f.x / lf, 0, f.z / lf); // up x n
      const s0 = v3(n.y * f.z - n.z * f.y, n.z * f.x - n.x * f.z, n.x * f.y - n.y * f.x), s = side === 'left' ? s0 : v3(-s0.x, -s0.y, -s0.z);
      const at = (k, m) => v3(wrist.x + f.x * k + s.x * m, wrist.y + f.y * k + s.y * m, wrist.z + f.z * k + s.z * m);
      a.wrist = { ...wrist }; a['middle-finger-phalanx-proximal'] = at(0.09, 0); a['index-finger-phalanx-proximal'] = at(0.08, 0.03); a['pinky-finger-phalanx-proximal'] = at(0.08, -0.03);
      a['thumb-tip'] = at(0.05, 0.08); a['index-finger-tip'] = at(0.16, 0.03);
    },
    // a fingertip at a world point (the poke), or both hands' thumb and index tips together or apart (a joint pinch)
    tip(side, world) { sim.hands[side].at['index-finger-tip'] = toTracking(world); },
    joint(side, name, p) { sim.hands[side].at[name] = { ...p }; },
    // the kit's last output, trimmed for reading
    out() {
      const o = xrOut; if (!o) return null;
      const r = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x !== 'object' || x === null).map(([k, x]) => [k, typeof x === 'number' ? +x.toFixed(3) : x])) : v);
      return { mode: o.mode, flying: o.flying, moving: o.moving, rig: r(o.rig), head: r(o.head), ring: r(o.ring), target: r(o.target), curtain: +o.curtain.toFixed(3), vignette: +o.vignette.level.toFixed(3),
        panel: o.panel && { shown: +o.panel.shown.toFixed(2), usable: o.panel.usable, mount: o.panel.mount, matrix: [...o.panel.matrix].map((x) => +x.toFixed(4)), width: o.panel.width, height: o.panel.height, cells: o.panel.face?.cells?.map((c) => c && c.label) },
        events: o.events.map((e) => e.type) };
    },
    toTracking,
    // the canvas (both eyes) after the next frame, saved by the dev server
    shot: (name) => new Promise((done) => sim.shots.push((url) => fetch('/save?name=' + encodeURIComponent(name) + '.png', { method: 'POST', body: url }).then(() => done(name)))),
    get session() { return sim.session; },
    get frame() { return sim.frame; },
  };
}
