// headsets: Apple Vision Pro in Safari (visionOS 26.2 and later draw WebGPU inside WebXR). xr.html only: build.mjs
// --xr bundles the locomotion kit (lib/webxr-locomotion, global LOCO) ahead of the scene and appends this file.
// Each eye is drawn forward straight into the headset's (foveated) texture, then an overlay pass hands the compositor
// depth and draws the kit's floor ring and target, wrist panel and comfort veil (vignette and curtain).
let xrOut = null; // the kit's last output (dev-xr.html's simulator reads it)
{
  // optional tuning: ?xrlod= scales LOD distances, ?xrfps= sets the target frame rate the LOD ladder aims for
  const XRLOD = clamp(+QP.get('xrlod') || 1, 0.5, 6);
  const XRFPS = +QP.get('xrfps') || 0;
  const O_XRD = O_LODB + 4; // view.xrd in sh_base.js

  // ── the city as the kit asks about it: world space, feet rather than the camera ──
  // the floor at (x, z) for feet near y. collide.js keeps the camera CLEAR above floors (CLEAR_W above water)
  const floorAt = (x, z, y) => { surfaceAt(x, z, y); return COL[0] - (COL[3] ? CLEAR_W : CLEAR); };
  const ground = (x, z, fromY) => { const y = floorAt(x, z, fromY); return { y, water: COL[3] > 0, level: 1 }; };
  // a ray against the floors: marched (finer near), the crossing found by halves. A floor that rises more than a stair
  // step across the crossing is the side of something built: a wall. Each sample asks surfaceAt from the ray's height
  // before it, as collide() asks from last frame's: a bridge deck counts only for what comes down onto it from above
  function raycast(o, d, far) {
    let a = 0;
    if (o.y < floorAt(o.x, o.z, o.y)) return null;
    while (a < far) {
      const b = min(far, a + max(0.25, a * 0.02)), y = o.y + d.y * b;
      if (y <= floorAt(o.x + d.x * b, o.z + d.z * b, o.y + d.y * a)) {
        let lo = a, hi = b;
        for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= floorAt(o.x + d.x * m, o.z + d.z * m, o.y + d.y * lo)) hi = m; else lo = m; }
        const x = o.x + d.x * hi, z = o.z + d.z * hi, py = o.y + d.y * hi, fh = floorAt(x, z, o.y + d.y * lo), water = COL[3] > 0;
        if (fh - floorAt(o.x + d.x * lo, o.z + d.z * lo, o.y + d.y * lo) > 0.6) {
          const l = hypot(d.x, d.z) || 1;
          return { point: { x, y: py, z }, normal: { x: -d.x / l, y: 0, z: -d.z / l }, distance: hi, kind: 'solid' };
        }
        const e = 0.3, gx = floorAt(x + e, z, fh + 1) - floorAt(x - e, z, fh + 1), gz = floorAt(x, z + e, fh + 1) - floorAt(x, z - e, fh + 1), n = hypot(gx, 2 * e, gz);
        return { point: { x, y: fh, z }, normal: { x: -gx / n, y: 2 * e / n, z: -gz / n }, distance: hi, kind: water ? 'water' : 'floor' };
      }
      a = b;
    }
    return null;
  }
  // collide() moves the screen's camera; borrow it for the feet (key C still switches collision off)
  function collideFeet(from, to) {
    if (!solid) return to;
    const sx = F[CX], sy = F[CY], sz = F[CZ], vx = F[VX], vy = F[VY], vz = F[VZ];
    F[CX] = to.x; F[CY] = to.y + CLEAR; F[CZ] = to.z; collide(from.x, from.y + CLEAR, from.z);
    const out = { x: F[CX], y: F[CY] - CLEAR, z: F[CZ] };
    F[CX] = sx; F[CY] = sy; F[CZ] = sz; F[VX] = vx; F[VY] = vy; F[VZ] = vz;
    return out;
  }
  // the six viewpoints (keys 1-6) as places. Those in the air leave you flying (the kit decides from the ground); the
  // kit's heading 0 looks along -z and turns left, the screen's yaw turns right
  const places = POSES.map((p, i) => {
    const g = floorAt(p[0], p[2], p[1]);
    return { id: 'view' + (i + 1), label: 'View ' + (i + 1), x: p[0], z: p[2], y: p[1] - g > 3 ? p[1] - 1.6 : g, yaw: atan2(p[0] - p[3], p[2] - p[5]), kind: 'place' };
  });
  const MUSIC = { id: 'music', label: 'Music', icon: 'music', action: 'music' };
  const makeLoco = (s) => LOCO.createLocomotion({
    profile: 'region',
    // a city to fly through: flight goes where you look, and gliding while looking up lifts you off the ground
    followPitch: true, takeOffByLookUp: true,
    world: { raycast, ground, collide: collideFeet, bounds: { centre: { x: 0, z: 0 }, radius: 6000, maxY: 2500 }, canFly: () => true },
    // you arrive (and Home is) on the podium's plaza, facing the great crystal
    destinations: places, start: 'view4', home: 'view4',
    panel: { items: [LOCO.ITEMS.fly, LOCO.ITEMS.turnLeft, LOCO.ITEMS.turnRight, LOCO.ITEMS.places, MUSIC, LOCO.ITEMS.exit], place: 'Atlantis' },
    hooks: {
      onExit: () => s.end(),
      onPanel: (a) => { if (a === 'music') dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); }, // music.js listens for M
    },
  });

  // ── shaders: overlays (depth handoff, markers, panel, comfort veil) and the forward scene, derived from the
  // deferred shaders so nothing is written twice ──
  const W_SRGB = /*wgsl*/`
override LINEAR = false; // the headset's format takes linear values (an -srgb or a float format): undo the encoding
fn enc(c: vec3f) -> vec3f { if (LINEAR) { return select(pow((max(c, vec3f(0.)) + .055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(.04045)); } return c; }
`;
  // the headset's depth for a view depth z, from its own projection (near 0, far 1; never 0, which visionOS
  // composites as transparent; 1e-7 still counts in a 24-bit depth)
  const W_XRD = /*wgsl*/`
fn xrDepth(z: f32) -> f32 { return clamp((view.xrd.x * -z + view.xrd.y) / (view.xrd.z * -z + view.xrd.w), 1e-7, 1.); }
`;
  // where a fragment is in the eye's view, carried from the vertices: never from @builtin(position), because Vision
  // Pro's eye textures are foveated (rasterized through a rate map in uneven pixels)
  const W_UV = /*wgsl*/`
struct UO { @builtin(position) p: vec4f, @location(0) uv: vec2f }
@vertex fn vsUV(@builtin(vertex_index) i: u32) -> UO { let q = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1)); return UO(vec4f(q, 0., 1.), vec2f(q.x * .5 + .5, .5 - q.y * .5)); }
`;
  const W_MARK = W_COMMON + W_SRGB + W_XRD + W_UV + /*wgsl*/`
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var tD: texture_depth_2d;
@group(0) @binding(2) var sP: sampler;
@group(0) @binding(3) var tP: texture_2d<f32>;
// one marker: placement, colour and alpha, quad size, 1 = hidden behind the city, 1 = the panel's face
struct Draw { m: mat4x4f, col: vec4f, opt: vec4f }
@group(1) @binding(0) var<uniform> dr: Draw;
struct MO { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex fn vsMark(@location(0) p: vec3f, @location(1) uv: vec2f) -> MO {
  return MO(view.vp * (dr.m * vec4f(p * vec3f(dr.opt.xy, 1.), 1.)), uv);
}
fn mark(i: MO) -> vec4f {
  if (dr.opt.z > .5) {
    let d = textureLoad(tD, clamp(vec2i(i.clip.xy), vec2i(0), vec2i(textureDimensions(tD)) - 1), 0);
    if (1. / i.clip.w > view.fwd.w / max(d, 1e-7) * 1.01 + .05) { discard; }
  }
  var c = dr.col.rgb; var a = dr.col.a;
  if (dr.opt.w > .5) { let t = textureSampleLevel(tP, sP, i.uv, 0.); c = t.rgb; a *= t.a; }
  return vec4f(enc(c) * a, a);
}
@fragment fn fsMark(i: MO) -> @location(0) vec4f { return mark(i); }
struct MD { @location(0) c: vec4f, @builtin(frag_depth) d: f32 }
@fragment fn fsMarkD(i: MO) -> MD { return MD(mark(i), xrDepth(1. / i.clip.w)); }
// the overlay pass's depth handoff: the headset's depth from the scene's at the same (foveated) pixel. Returns a
// masked-off colour too, as WebKit refuses a bare frag_depth return against bgra8unorm
@fragment fn fsZ(i: UO) -> MD { return MD(vec4f(0.), xrDepth(view.fwd.w / max(textureLoad(tD, vec2i(i.p.xy), 0), 1e-9))); }
${LOCO.OVERLAY_WGSL}
// the kit's vignette and curtain, head-locked: black over the eye by its angle from straight ahead
@fragment fn fsVeil(i: UO) -> @location(0) vec4f {
  let ndc = vec2f(i.uv.x * 2. - 1., 1. - i.uv.y * 2.) - view.jit.xy;
  return vec4f(0., 0., 0., locomotion_overlay(vec3f(ndc.x * view.right.w, ndc.y * view.up.w, -1.), dr.col.x, dr.col.y));
}
`;
  // the city probe: a cube of the opaque city and sky in linear light, drawn once from the great crystal's axis
  // (0, 44.4, 0, rising 101 m), for solid crystals to show through themselves and thin panels to grade against
  const CITY = { x: 0, y: 60, z: 0, n: 256 };
  // a replacement that must match exactly once; whitespace in the pattern matches any or none (build.mjs squeezes WGSL)
  const once = (str, a, b) => {
    const re = new RegExp(a.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
    if ((str.match(re) || []).length !== 1) throw new Error('xr.js forward: expected one "' + a + '"');
    return str.replace(re, () => b);
  };
  const W_FIN = W_AGX + /*wgsl*/`
// the final image per fragment: exposure, white balance, AgX, dither; blended ones graded unpremultiplied.
// TONE off: linear light, for the city probe
override TONE = true;
fn fin(c0: vec3f, fc: vec2f) -> vec3f {
  if (!TONE) { return c0; }
  let c = agx(c0 * view.sunc.w * vec3f(1.07, 1., .9));
  return enc(c + (ign(fc) + ign(fc + 37.) - 1.) / 255.);
}
fn finA(c: vec4f, fc: vec2f) -> vec4f { if (c.a <= 0.) { return vec4f(0.); } return vec4f(fin(c.rgb / c.a, fc) * c.a, c.a); }

`;
  // Every level draws as Low does (W_GBUF_LOW), because a shader that can discard turns off the GPU's hidden-surface
  // removal. LODs swap at mid-fade in the vertex stage instead of dissolving, and leaves lay their cut-out depth first
  // (fsPre) and are coloured where it is theirs, so no lit shader discards. @invariant keeps both passes' depth identical.
  const lowVS = (s) => LV > 1 ? s : once(once(s, 'if (LV > 1) { if (((e >> 24u) & 127u) < 64u)', 'if (true) { if (((e >> 24u) & 127u) < 64u)'),
    '@builtin(position) clip: vec4f,', '@invariant @builtin(position) clip: vec4f,');
  const W_FWD = once(once(lowVS(W_GBUF_LOW), '@fragment fn fs(i: VO) -> GO {', 'fn gbuf(i: VO) -> GO {'),
    '@fragment fn fsLeafLow(i: VO) -> GO {', 'fn gbufLeaf(i: VO) -> GO {') + /*wgsl*/`
@group(1) @binding(0) var tSky: texture_2d<f32>;
@group(1) @binding(1) var tEnv: texture_cube<f32>;
@group(1) @binding(2) var tIrr: texture_cube<f32>;
@group(1) @binding(3) var tSh0: texture_depth_2d;
@group(1) @binding(4) var tSh1: texture_depth_2d;
@group(1) @binding(5) var tSh2: texture_depth_2d;
@group(1) @binding(6) var tSh3: texture_depth_2d;
@group(1) @binding(7) var tWater: texture_2d<f32>;
@group(1) @binding(8) var tTop: texture_2d<f32>;
@group(1) @binding(9) var sCmp: sampler_comparison;
` + W_SKY + W_SHADOWLIB + W_SHADE + W_LIGHT_SKYVIS + W_SRGB + W_FIN + /*wgsl*/`
// the light pass's screen-space inputs as Low has them: no ambient occlusion texture, the haze taken as sunlit
fn ssao(fc: vec2f, z: f32) -> f32 { return 1.; }
fn shafts(fc: vec2f, z: f32, rd: vec3f) -> vec3f {
  let mu = dot(rd, view.sun.xyz); let g = .78; let hg = (1. - g * g) / (4. * PI * pow(1. + g * g - 2. * g * mu, 1.5));
  return view.sunc.rgb * (min(hg, .8) * 1.2e-5 + 1e-6) * min(z / max(dot(rd, view.fwd.xyz), 1e-3), 800.) * exp(-max(view.cam.y, 0.) / 650.) * .85;
}
// the light pass's body on a surface straight from the material code
fn shadeG(gS: GO, wp: vec3f, fc: vec4f) -> vec3f {
  let dv = wp - view.cam.xyz; let dist = max(length(dv), 1e-4); let rd = dv / dist; let z = dot(dv, view.fwd.xyz);
  let g0 = gS.a; let g1 = gS.n; let g2 = gS.m;
` + W_LIGHT_BODY + /*wgsl*/`  return aerial(col, view.cam.xyz, rd, dist) + shafts(fc.xy, z, rd);
}
@fragment fn fsF(i: VO) -> @location(0) vec4f { return vec4f(fin(shadeG(gbuf(i), i.wp, i.clip), i.clip.xy), 1.); }
@fragment fn fsLeafF(i: VO) -> @location(0) vec4f { return vec4f(fin(shadeG(gbufLeaf(i), i.wp, i.clip), i.clip.xy), 1.); }
// the sky where nothing was drawn (depth still 0): a full-screen triangle carrying the view ray
struct SO { @builtin(position) p: vec4f, @location(0) ray: vec3f }
@vertex fn vsSky(@builtin(vertex_index) k: u32) -> SO {
  let q = vec2f(f32(i32(k & 1u) * 4 - 1), f32(i32(k >> 1u) * 4 - 1)); let n = q - view.jit.xy;
  return SO(vec4f(q, 0., 1.), view.fwd.xyz + view.right.xyz * n.x * view.right.w + view.up.xyz * n.y * view.up.w);
}
@fragment fn fsSkyF(i: SO) -> @location(0) vec4f {
  let rd = normalize(i.ray); var c = sky(rd, true);
  // below the horizon: the sea beyond its 95 km mesh, long dissolved into haze
  if (rd.y < 0.) { c = aerial(vec3f(0.), view.cam.xyz, rd, view.cam.y / max(0. - rd.y, 1e-5)); }
  return vec4f(fin(c + shafts(i.p.xy, 1e6, rd), i.p.xy), 1.);
}
`;
  // crystal, water, cascades and glass: their copy-free branches (the mirror view's: view.misc.y as 1), graded and
  // premultiplied per fragment. Solid crystals show the city probe through themselves; thin panels (lotus petals,
  // balcony panels) blend over the scene behind them; water reads a copy of the opaque depth for the column under it
  // and lets the floor already drawn show through.
  let W_FWDFX = lowVS(W_FX + W_FX2).replace(/view\.misc\.y\b/g, '1.').replace(/discard;/g, '');
  W_FWDFX = once(W_FWDFX, 'var under = textureSampleLevel(tScene, sLin, uv2, 0.).rgb;', 'var under = vec3f(0.);');
  W_FWDFX = once(W_FWDFX, 'under = under * exp(-sig * (path + depth * .6)) + scat * (1. - exp(-sA * path));',
    'let wT = exp(-sig * (path + depth * .6)); let wTs = min(wT.r, min(wT.g, wT.b)); var wk = 1.; under = scat * (1. - exp(-sA * path)) + (wT - wTs) * (view.sunc.rgb * shw * max(L.y, 0.) + amb * .4) * .5;');
  W_FWDFX = once(W_FWDFX, 'if (kind < 2u) { col *= mix(.5, 1., ss(0., .35, thick0)); }', 'if (kind < 2u) { col *= mix(.5, 1., ss(0., .35, thick0)); wk *= mix(.5, 1., ss(0., .35, thick0)); }');
  W_FWDFX = once(W_FWDFX, 'col = mix(col, amb * .55 + view.sunc.rgb * sh * .22, edge * .8);', 'col = mix(col, amb * .55 + view.sunc.rgb * sh * .22, edge * .8); wk *= 1. - edge * .8;');
  W_FWDFX = once(W_FWDFX, '} else { col += vec3f(.4, .9, .85) * pl * .25; }\n  return FO(vec4f(aerial(col, view.cam.xyz, rd, dist), 1.));',
    // the haze in front of the floor seen through is already on the floor, so it comes in here by the water's own share
    '} else { col += vec3f(.4, .9, .85) * pl * .25; }\n  let wa = 1. - wTs * (1. - select(F, min(F, .55), kind == 1u)) * wk;\n  return FO(vec4f(aerial(col, view.cam.xyz, rd, dist) - aerial(vec3f(0.), view.cam.xyz, rd, dist) * (1. - wa), wa));');
  for (const k of ['Water', 'Cascade', 'Crystal', 'Glass']) W_FWDFX = once(W_FWDFX, `@fragment fn fs${k}(i: VO) -> FO {`, `fn fx${k}(i: VO) -> FO {`);
  W_FWDFX = once(W_FWDFX, 'if (1. > .5) { return env; }', 'if (1. > .5) { return city(pe, d); }');
  W_FWDFX = once(W_FWDFX, 'if (slab && size < 6. && 1. < .5) {', 'if (THINP) { bg = vec3f(0.); } else if (1. < .5) {');
  W_FWDFX = once(W_FWDFX, '  col += bg * (1. - F);\n  return FO(vec4f(aerial(col, view.cam.xyz, rd, dist), 1.));',
    '  col += bg * (1. - F);\n  if (THINP) { return FO(vec4f(aerial(col, view.cam.xyz, rd, dist), 1. - sat(lum(tint) * mix(1., .8, inner) * ft * (1. - F)))); }\n  return FO(vec4f(aerial(col, view.cam.xyz, rd, dist), 1.));');
  W_FWDFX += /*wgsl*/`
override THINP = false; // the thin list (lotus petals, balcony panels): blended over the scene drawn behind them
@group(1) @binding(11) var tCity: texture_cube<f32>;
// the probe along a ray from p: where the ray leaves a 250 m sphere round it, so crystals off its centre see their side
const CITYP = vec3f(${CITY.x}., ${CITY.y}., ${CITY.z}.);
fn city(p: vec3f, d: vec3f) -> vec3f {
  let o = p - CITYP; let b = dot(o, d); let t = -b + sqrt(max(b * b - dot(o, o) + 62500., 0.));
  return textureSampleLevel(tCity, sLin, o + d * t, 0.).rgb;
}
` + W_SRGB + W_FIN + ['Water', 'Cascade', 'Crystal', 'Glass'].map((k) => `@fragment fn fs${k}F(i: VO) -> @location(0) vec4f { return finA(fx${k}(i).c, i.clip.xy); }\n`).join('')
    + /*wgsl*/`
// a thin panel: light of its own (c.rgb) over a share (1 - c.a) of what's behind, graded against the probe's estimate
// of that background so AgX compresses the sum rather than the panel alone
@fragment fn fsThinF(i: VO) -> @location(0) vec4f {
  let c = fxCrystal(i).c; let T = 1. - c.a; let b = city(i.wp, normalize(i.wp - view.cam.xyz)) + view.sunc.rgb * .1;
  return vec4f(max(fin(c.rgb + b * T, i.clip.xy) - fin(b, i.clip.xy) * T, vec3f(0.)), c.a);
}
`;
  // pipelines compiled ahead (at load, for bgra8unorm) so entering the headset doesn't stall
  let FP = null, FB = null, FD = null, PR = null;
  function fwdPipes(fmt) {
    if (FP && FP.fmt === fmt) return FP.ready;
    const constants = { LINEAR: fmt.endsWith('-srgb') || fmt.includes('float') ? 1 : 0 }, probe = { LINEAR: 0, TONE: 0 };
    const mO = mod(W_FWD, 'xr-forward'), mX = mod(W_FWDFX, 'xr-forward-fx'), lL = layout('tkkddddttc', SS.FRAGMENT), plO = plOf(lScene, lL);
    const lX = layout('tdttkddddtck', SS.FRAGMENT), plX = plOf(lScene, lX);
    const ds = (write, cmp = 'greater') => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: cmp });
    const mk = (m, pl, fs, cull, depth, blend, o = {}) => device.createRenderPipelineAsync({ layout: pl,
      vertex: { module: m, entryPoint: o.vs || 'vs', buffers: o.vs ? [] : vbLay },
      fragment: { module: m, entryPoint: fs, targets: [{ format: o.fmt || fmt, blend, writeMask: o.mask ?? 15 }], constants: o.k || constants },
      primitive: { cullMode: cull }, depthStencil: depth });
    const pre = 'fsPre', leaf = LV > 1 ? 'fsLeafF' : 'fsF'; // Low's plainer leaves, else the full material
    if (!PR) {
      const t = device.createTexture({ size: [CITY.n, CITY.n, 6], format: HDR, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
      PR = { cube: t.createView({ dimension: 'cube' }), faces: [0, 1, 2, 3, 4, 5].map((f) => t.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1 })),
        depth: tex(CITY.n, CITY.n, 'depth32float', TU.RENDER_ATTACHMENT).createView(), drawn: false };
    }
    FB = { light: group(lL, [tSky, cubeView(tEnv), cubeView(tIrr), tSh[0], tSh[1], tSh[2], tSh[3], tWater, tTop, sCmp]),
      fx: group(lX, [tDummyC, tDummyD, tDummyC, tSky, cubeView(tEnv), tSh[0], tSh[1], tSh[2], tSh[3], tWater, sCmp, PR.cube]), lX };
    FP = { fmt };
    // the probe's: linear light into a float cube; a cube's faces are mirror images (left-handed), so they cull fronts
    const P = { fmt: HDR, k: probe }, names = ['solid', 'pre', 'leaf', 'sky', 'crystal', 'thin', 'water', 'cascade', 'glassB', 'glassF', 'pSolid', 'pPre', 'pLeaf', 'pSky'];
    // one at a time: compiled together, the shaders caused a post-load memory spike and lost the device on Medium
    const jobs = [
      () => mk(mO, plO, 'fsF', 'back', ds(true)), () => mk(mO, plO, pre, 'none', ds(true), undefined, { mask: 0 }), () => mk(mO, plO, leaf, 'none', ds(false, 'equal')),
      () => mk(mO, plO, 'fsSkyF', 'none', ds(false, 'equal'), undefined, { vs: 'vsSky' }),
      () => mk(mX, plX, 'fsCrystalF', 'back', ds(true)), () => mk(mX, plX, 'fsThinF', 'back', ds(true), PREMUL, { k: { ...constants, THINP: 1 } }), () => mk(mX, plX, 'fsWaterF', 'none', ds(true), PREMUL),
      () => mk(mX, plX, 'fsCascadeF', 'none', ds(false), PREMUL), () => mk(mX, plX, 'fsGlassF', 'front', ds(false), PREMUL), () => mk(mX, plX, 'fsGlassF', 'back', ds(false), PREMUL),
      () => mk(mO, plO, 'fsF', 'front', ds(true), undefined, P), () => mk(mO, plO, pre, 'none', ds(true), undefined, { ...P, mask: 0 }), () => mk(mO, plO, leaf, 'none', ds(false, 'equal'), undefined, P),
      () => mk(mO, plO, 'fsSkyF', 'none', ds(false, 'equal'), undefined, { ...P, vs: 'vsSky' }),
    ];
    FP.ready = jobs.reduce((all, job) => all.then((ps) => job().then((p) => [...ps, p])), Promise.resolve([]))
      .then((ps) => { names.forEach((n, i) => { FP[n] = ps[i]; }); return FP; });
    return FP.ready;
  }
  // the probe's six faces, each from its own view (reusing the mirror slot). Cube faces look along +x, -x, +y, -y, +z, -z
  const FACES = [[0, 0, -1, 0, 1, 0, 1, 0, 0], [0, 0, 1, 0, 1, 0, -1, 0, 0], [1, 0, 0, 0, 0, -1, 0, 1, 0], [1, 0, 0, 0, 0, 1, 0, -1, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, -1]];
  function drawProbe() {
    if (PR.drawn) return;
    const M = UB[V_MIR]; M.set(UB[V_MAIN]);
    for (let f = 0; f < 6; f++) {
      setView(M, CITY.x, CITY.y, CITY.z, FACES[f], -1, 1, -1, 1, CITY.n, CITY.n, 0, 0);
      M[O_JIT + 3] = -1e9; M[O_MISC + 1] = 0; M[O_MISC + 2] = LODK * 2; M[O_LODC] = CITY.x; M[O_LODC + 1] = CITY.y; M[O_LODC + 2] = CITY.z; M[O_LODC + 3] = 1 / LODK;
      Q.writeBuffer(ubo[V_MIR], 0, M);
      const e = device.createCommandEncoder(), c = e.beginComputePass(); cullView(c, V_MIR); c.end();
      const r = e.beginRenderPass({ colorAttachments: [{ view: PR.faces[f], loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
        depthStencilAttachment: { view: PR.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      r.setBindGroup(0, bgScene[V_MIR]); r.setBindGroup(1, FB.light); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
      r.setPipeline(FP.pSolid); drawList(r, V_MIR, LS[K.SOLID].all);
      r.setPipeline(FP.pPre); drawList(r, V_MIR, LS[K.LEAF].all); r.setPipeline(FP.pLeaf); drawList(r, V_MIR, LS[K.LEAF].all);
      r.setPipeline(FP.pSolid); drawList(r, V_MIR, LS[K.SOLID].gnd);
      r.setPipeline(FP.pSky); r.draw(3); r.end();
      Q.submit([e.finish()]);
    }
    PR.drawn = true;
  }
  // the scene's depth: one texture the size of the eye's (both eyes take turns with it), plus a copy for water
  function fwdDepth(w, h) {
    if (FD && FD.w === w && FD.h === h && FB.fxD && P.bgMark) return;
    FD?.tex.destroy(); FD?.copy.destroy();
    const t = tex(w, h, 'depth32float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_SRC), c = tex(w, h, 'depth32float', TU.COPY_DST | TU.TEXTURE_BINDING);
    FD = { w, h, tex: t, view: t.createView(), copy: c };
    FB.fxD = group(FB.lX, [tDummyC, c, tDummyC, tSky, cubeView(tEnv), tSh[0], tSh[1], tSh[2], tSh[3], tWater, sCmp, PR.cube]);
    P.bgMark = group(P.lMark, [ubo[V_MAIN], t, sLin, P.tPanel]);
  }
  // one eye: opaque scene into the eye's texture over reversed depth, depth copy, blended water/crystals/cascades/glass,
  // then the headset's depth handoff and the kit's markers, panel and veil
  function fwdEye(v, e) {
    const vp = v.port;
    let r = e.beginRenderPass({ colorAttachments: [{ view: v.view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: FD.view, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    r.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
    r.setBindGroup(0, bgScene[V_MAIN]); r.setBindGroup(1, FB.light); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
    r.setPipeline(FP.solid); drawList(r, V_MAIN, LS[K.SOLID].all);
    // leaves: their cut-out depth first, then shaded only where it is theirs
    r.setPipeline(FP.pre); drawList(r, V_MAIN, LS[K.LEAF].all); r.setPipeline(FP.leaf); drawList(r, V_MAIN, LS[K.LEAF].all);
    // the ground they hide, last
    r.setPipeline(FP.solid); drawList(r, V_MAIN, LS[K.SOLID].gnd);
    r.setBindGroup(1, FB.fx); r.setPipeline(FP.crystal); drawList(r, V_MAIN, lsSolidX);
    // the sky after everything opaque, before anything blended
    r.setBindGroup(1, FB.light); r.setPipeline(FP.sky); r.draw(3);
    r.end();
    // copy depth for water, then draw blended surfaces over the opaque scene
    e.copyTextureToTexture({ texture: FD.tex }, { texture: FD.copy }, [FD.w, FD.h]);
    r = e.beginRenderPass({ colorAttachments: [{ view: v.view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: FD.view, depthLoadOp: 'load', depthStoreOp: 'store' } });
    r.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
    r.setBindGroup(0, bgScene[V_MAIN]); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
    r.setBindGroup(1, FB.fxD); r.setPipeline(FP.water); drawList(r, V_MAIN, LS[K.WATER].all);
    r.setBindGroup(1, FB.fx); r.setPipeline(FP.thin); drawList(r, V_MAIN, lsThinX);
    r.setPipeline(FP.cascade); drawList(r, V_MAIN, LS[K.CASCADE].all);
    r.setPipeline(FP.glassB); drawList(r, V_MAIN, LS[K.GLASS].all); r.setPipeline(FP.glassF); drawList(r, V_MAIN, LS[K.GLASS].all);
    r.end();
    // overlay pass: headset depth from the scene's, then markers, panel and veil
    r = e.beginRenderPass({ colorAttachments: [{ view: v.view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: v.depth ? { view: v.depth, depthLoadOp: 'load', depthStoreOp: 'store' } : undefined });
    r.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
    if (v.depth) { r.setPipeline(P.fz); r.setBindGroup(0, P.bgMark); r.setBindGroup(1, P.bgDraw, [0]); r.draw(3); }
    r.setPipeline(P.mark); r.setBindGroup(0, P.bgMark); r.setVertexBuffer(0, P.vb); r.setIndexBuffer(P.ib, 'uint16');
    for (let k = 0; k < 5; k++) if (ON[k]) { const g = P.at[PART[k]]; r.setBindGroup(1, P.bgDraw, [k * SLOT * 4]); r.drawIndexed(g.count, 1, g.first, g.base); }
    if (veil) { r.setPipeline(P.veil); r.setBindGroup(1, P.bgDraw, [5 * SLOT * 4]); r.draw(3); }
    r.end();
  }
  const PANEL_W = 600, PANEL_H = 400, SLOTS = 6, SLOT = 64; // 256 bytes a marker: dynamic offsets
  let P = null; // overlay pipelines and buffers, made on the first session
  function pipes(fmt, depth, wantDepth) {
    if (P && P.fmt === fmt && P.depth === depth) return P;
    const constants = { LINEAR: fmt.endsWith('-srgb') || fmt.includes('float') ? 1 : 0 }, target = (blend) => [{ format: fmt, blend }];
    const mM = mod(W_MARK, 'xr-marks');
    const ds = (write) => (depth ? { depthStencil: { format: depth, depthWriteEnabled: write, depthCompare: 'always' } } : {}), D = depth ? 'D' : '';
    const lMark = layout('udst'), lDraw = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { hasDynamicOffset: true } }] }), pl = plOf(lMark, lDraw);
    const ubDraw = device.createBuffer({ size: SLOTS * SLOT * 4, usage: BU.UNIFORM | BU.COPY_DST });
    // ring, target disc, arrow and a 1 x 1 quad (panel, tab) in one buffer: position, uv
    const parts = [LOCO.ringGeometry(), LOCO.discGeometry(), LOCO.arrowGeometry(), LOCO.quadGeometry(1, 1)];
    const nv = parts.reduce((s, g) => s + g.positions.length / 3, 0), ni = parts.reduce((s, g) => s + g.indices.length, 0);
    const vtx = new Float32Array(nv * 5), idx = new Uint16Array(ni + (ni & 1)), at = [];
    let v0 = 0, i0 = 0;
    for (const g of parts) {
      const n = g.positions.length / 3;
      for (let i = 0; i < n; i++) { vtx.set(g.positions.subarray(i * 3, i * 3 + 3), (v0 + i) * 5); if (g.uvs) vtx.set(g.uvs.subarray(i * 2, i * 2 + 2), (v0 + i) * 5 + 3); }
      idx.set(g.indices, i0); at.push({ first: i0, count: g.indices.length, base: v0 }); v0 += n; i0 += g.indices.length;
    }
    const canvas2d = document.createElement('canvas'); canvas2d.width = PANEL_W; canvas2d.height = PANEL_H;
    const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
    P = {
      fmt, depth, wantDepth, lMark, ubDraw, at, canvas2d, ctx2d: canvas2d.getContext('2d', { willReadFrequently: true }), key: '', bgMark: null,
      vb: buf(vtx, BU.VERTEX), ib: buf(idx, BU.INDEX), tPanel: tex(PANEL_W, PANEL_H, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST),
      bgDraw: device.createBindGroup({ layout: lDraw, entries: [{ binding: 0, resource: { buffer: ubDraw, size: 96 } }] }),
      mark: device.createRenderPipeline({ layout: pl, vertex: { module: mM, entryPoint: 'vsMark', buffers: [{ arrayStride: 20, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'float32x2')] }] },
        fragment: { module: mM, entryPoint: 'fsMark' + D, targets: target(PREMUL), constants }, ...ds(true) }),
      veil: device.createRenderPipeline({ layout: pl, vertex: { module: mM, entryPoint: 'vsUV' }, fragment: { module: mM, entryPoint: 'fsVeil', targets: target(PREMUL), constants }, ...ds(false) }),
      fz: depth ? device.createRenderPipeline({ layout: pl, vertex: { module: mM, entryPoint: 'vsUV' }, fragment: { module: mM, entryPoint: 'fsZ', targets: [{ format: fmt, writeMask: 0 }], constants }, ...ds(true) }) : null,
    };
    FD?.tex.destroy(); FD?.copy.destroy(); FD = null;
    return P;
  }

  // what the kit asks to draw this frame: one slot each for ring, disc, arrow, panel, tab and the veil
  const DR = new Float32Array(SLOTS * SLOT), ON = [0, 0, 0, 0, 0], PART = [0, 1, 2, 3, 3], MAT = new Float32Array(16);
  let veil = 0;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  function put(k, m, rgb, a, sx, sy, hide, face) { const o = k * SLOT; DR.set(m, o); DR.set(rgb, o + 16); DR[o + 19] = a; DR[o + 20] = sx; DR[o + 21] = sy; DR[o + 22] = hide; DR[o + 23] = face; ON[k] = 1; }
  function marks(out) {
    const S = LOCO.STYLE; ON.fill(0);
    if (out.ring) put(0, LOCO.placeMatrix(out.ring, 0, MAT), hex(S.ring.color), S.ring.alpha, 1, 1, 1, 0);
    if (out.target) {
      const st = out.target.valid ? S.target : S.cancelled;
      put(1, LOCO.placeMatrix(out.target, out.target.yaw, MAT), hex(st.color), st.alpha, 1, 1, 1, 0);
      put(2, MAT, hex(S.arrow.color), S.arrow.alpha, 1, 1, 1, 0);
    }
    if (out.panel) {
      put(3, out.panel.matrix, [1, 1, 1], out.panel.shown, out.panel.width, out.panel.height, 0, 1);
      if (out.panel.faceKey !== P.key) {
        P.key = out.panel.faceKey; LOCO.paintPanelFace(P.ctx2d, out.panel.face);
        Q.writeTexture({ texture: P.tPanel }, P.ctx2d.getImageData(0, 0, PANEL_W, PANEL_H).data, { bytesPerRow: PANEL_W * 4 }, [PANEL_W, PANEL_H]);
      }
    }
    if (out.tab && !out.tab.open) put(4, out.tab.matrix, [0.9, 0.95, 1], 0.55, out.tab.width, out.tab.height, 0, 0);
    veil = out.curtain > 1e-3 || out.vignette.level > 1e-3 ? 1 : 0; DR[5 * SLOT + 16] = out.vignette.level; DR[5 * SLOT + 17] = out.curtain;
    Q.writeBuffer(P.ubDraw, 0, DR);
  }

  // ── the session ──
  // one eye for render(): position, axes (right, up, forward), frustum tangents from the projection, the head's centre
  // and forward, and where its picture goes
  const V = [0, 1].map((i) => ({ i, last: true, x: 0, y: 0, z: 0, B: new Float64Array(9), tl: 0, tr: 0, tb: 0, tt: 0, hx: 0, hy: 0, hz: 0, hf: new Float64Array(3), view: null, depth: null, port: null, fwd: null }));
  for (const v of V) v.fwd = (e) => fwdEye(v, e);
  let session = null, binding = null, layer = null, xin = null, loco = null, lastT = 0, head = null;
  function xrFrame(t, f) {
    if (f.session !== session) return;
    session.requestAnimationFrame(xrFrame);
    if (dead) return;
    const out = loco.update(xin.read(f, t)), pose = f.getViewerPose(xin.apply(out.rig));
    xrOut = out;
    if (!pose) return;
    head = out.head;
    const dt = lastT ? min((t - lastT) / 1000, 0.1) : 0; lastT = t; F[TIME] += dt; F[DT] = dt;
    const n = min(pose.views.length, 2), h = pose.transform.matrix, U = UB[V_MAIN];
    for (let i = 0; i < n; i++) {
      const view = pose.views[i], sub = binding.getViewSubImage(layer, view), vp = sub.viewport, v = V[i], m = view.transform.matrix, p = view.projectionMatrix;
      if (!i) {
        const df = P.wantDepth && sub.depthStencilTexture ? P.wantDepth : null;
        if (df !== P.depth) { pipes(P.fmt, df, P.wantDepth); P.key = ''; }
        const tex0 = sub.colorTexture, fov = min(1, sqrt(tex0.width * tex0.height / (vp.width * vp.height)));
        pace();
        W = max(2, round(vp.width * fov) & ~1); H = max(2, round(vp.height * fov) & ~1);
        fwdDepth(tex0.width, tex0.height);
        marks(out);
      }
      v.x = m[12]; v.y = m[13]; v.z = m[14];
      v.B[0] = m[0]; v.B[1] = m[1]; v.B[2] = m[2]; v.B[3] = m[4]; v.B[4] = m[5]; v.B[5] = m[6]; v.B[6] = -m[8]; v.B[7] = -m[9]; v.B[8] = -m[10];
      v.tl = (p[8] - 1) / p[0]; v.tr = (p[8] + 1) / p[0]; v.tb = (p[9] - 1) / p[5]; v.tt = (p[9] + 1) / p[5];
      v.hx = h[12]; v.hy = h[13]; v.hz = h[14]; v.hf[0] = -h[8]; v.hf[1] = -h[9]; v.hf[2] = -h[10];
      v.last = i === n - 1;
      // the eye's layer: as the browser describes it, or by its index where it doesn't (an earlier draft of the binding)
      const desc = sub.getViewDescriptor ? sub.getViewDescriptor() : sub.colorTexture.depthOrArrayLayers > 1 ? { dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 } : undefined;
      v.view = sub.colorTexture.createView(desc); v.port = vp;
      v.depth = P.depth && sub.depthStencilTexture ? sub.depthStencilTexture.createView(desc && { dimension: desc.dimension, baseArrayLayer: desc.baseArrayLayer, arrayLayerCount: desc.arrayLayerCount }) : null;
      U[O_XRD] = p[10]; U[O_XRD + 1] = p[14]; U[O_XRD + 2] = p[11]; U[O_XRD + 3] = p[15];
      render0(v);
    }
  }

  // ── the frame rate steers detail: a ladder of LOD distances from Low's toward Medium's (0.65) and High's (0.5).
  // Up a rung after 2 s that keep up, down at once when one doesn't, with a 12 s cooldown so it doesn't see-saw ──
  const RUNGS = [1, 0.8, 0.65, 0.5], dyn = { n: 0, t0: 0, rung: 0, good: 0, need: 2 };
  function pace() {
    const t = performance.now();
    if (!dyn.t0) { dyn.t0 = t; dyn.n = 0; return; }
    if (++dyn.n < 2 || t - dyn.t0 < 1000) return;
    const fps = dyn.n * 1000 / (t - dyn.t0), hz = XRFPS || session.frameRate || 90;
    dyn.t0 = t; dyn.n = 0;
    if (fps < hz * 0.9) { if (dyn.rung) { dyn.rung--; dyn.need = 12; } dyn.good = 0; }
    else if (fps > hz * 0.96 && ++dyn.good >= dyn.need) { dyn.rung = min(RUNGS.length - 1, dyn.rung + 1); dyn.good = 0; dyn.need = 2; }
    lodx = RUNGS[dyn.rung] * XRLOD;
  }

  async function start(s) {
    session = s; head = null; xrOn = true; errEl.hidden = true;
    // pause desktop rendering and free its targets (hundreds of MB on Medium/High) before allocating headset layers
    // and compiling the forward pipelines
    for (const t of targets) t.destroy(); targets = []; hist = null;
    s.addEventListener('end', stop, { once: true });
    try {
      binding = new XRGPUBinding(s, device);
      const fmt = binding.getPreferredColorFormat();
      let depth = 'depth32float';
      try { layer = binding.createProjectionLayer({ colorFormat: fmt, depthStencilFormat: depth }); }
      catch (e) { console.warn('no depth layer: ' + e.message); depth = null; layer = binding.createProjectionLayer({ colorFormat: fmt }); }
      s.updateRenderState({ layers: [layer] });
      pipes(fmt, depth, depth); P.key = '';
      await fwdPipes(fmt); drawProbe();
      xin = LOCO.createXRInput(s, { baseSpace: await LOCO.requestBaseSpace(s) });
      loco = makeLoco(s);
    } catch (e) { console.error(e); errEl.textContent = 'VR failed to start: ' + e.message; errEl.hidden = false; s.end().catch(() => 0); return; }
    NEAR = 0.1; lodx = XRLOD; hud = false; lastT = 0; dyn.t0 = 0; dyn.rung = dyn.good = 0; dyn.need = 2;
    s.requestAnimationFrame(xrFrame);
  }
  function stop() {
    xin?.dispose(); xin = null; session = binding = layer = loco = null;
    FD?.tex.destroy(); FD?.copy.destroy(); FD = null;
    if (!xrOn) return;
    xrOn = false; NEAR = 0.3; lodx = 1;
    // the screen carries on from where the head was
    if (head) { F[CX] = head.x; F[CY] = head.y; F[CZ] = head.z; F[YAW] = -head.yaw; F[PIT] = head.pitch; F[VX] = F[VY] = F[VZ] = 0; }
    W = H = 0; resize(); ui(true);
  }
  device.lost.then(() => session?.end());

  // the menu's Enter VR, where the browser can put WebGPU into a headset; styled as the Enter button
  const go = document.createElement('button'); go.id = 'x'; go.textContent = 'Enter VR'; go.hidden = true; $('d').after(go);
  const errEl = document.createElement('p'); errEl.hidden = true; errEl.style.cssText = 'color:#ff9b96;font-size:.8em;letter-spacing:0;text-transform:none'; go.after(errEl);
  for (const sh of document.styleSheets) for (const r of [...sh.cssRules]) if (r.selectorText?.includes('#d')) sh.insertRule(r.cssText.replaceAll('#d', '#x'), sh.cssRules.length);
  if (navigator.xr && 'XRGPUBinding' in window) navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    go.hidden = !ok;
    // pre-compile forward pipelines on Low; on Medium/High wait until start() frees desktop targets to avoid OOM
    if (ok && LV > 1) fwdPipes('bgra8unorm').catch((e) => console.error('forward pipelines:', e));
  }, () => 0);
  // straight from the click: Safari grants an immersive session only inside the user's gesture
  go.onclick = () => { errEl.hidden = true; LOCO.enterVR({ init: { requiredFeatures: ['local-floor', 'webgpu'], optionalFeatures: ['hand-tracking', 'layers'] } })
    .then(start, (e) => { errEl.textContent = 'VR failed to start: ' + e.message; errEl.hidden = false; }); };
}
