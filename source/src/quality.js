// detail level, chosen before anything is built
// LV: 0 High, 1 Medium, 2 Low: the same world, built and drawn with less detail (see README.md). QL(high, medium, low).
// localStorage.atlantis = "level,pixels" (pixels: the resolution frame() settled on). atlantisLoad still set on the next
// visit means that load crashed the tab or driver, so start a level lower. ?lv=0..2 picks a level without storing it.
const QP = new URLSearchParams(location.search), AUTO = QP.has('auto');
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { if (!AUTO && !QP.has('lv')) try { localStorage[k] = v; } catch {} };
let SV = [], LV = 0;
if (QP.has('lv')) LV = clamp(+QP.get('lv') | 0, 0, 2);
else if (!AUTO) {
  let bad; try { SV = (localStorage.atlantis || '').split(','); bad = localStorage.atlantisLoad; } catch {}
  // first visit: phones Low (Medium with 8 GB), computers High (Low with <= 4 GB)
  LV = SV[0] ? clamp(+SV[0] | 0, 0, 2) : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
  if (bad && LV < 2) { SV = [++LV]; keep('atlantis', LV); }
}
const QL = (h, m, l) => (LV > 1 ? l : LV ? m : h), LVN = ['High', 'Medium', 'Low'];
// sun shadow map sizes: the camera cascade (0: none), then the baked city, shelf and mountain maps. 32-bit depth
// where shafts march through them (16-bit gave bright rings around the low sun)
const SHN = QL([2048, 8192, 4096, 2048], [1024, 4096, 2048, 1024], [0, 4096, 2048, 1024]), SH32 = LV < 2, CASC = SHN[0];
// LODs switch this much sooner (far limits stay: see `cull` in sh_scene.js)
const LODK = QL(1, 1.3, 2);
// tree leaf cards: this much smaller (plants.js), and how much more of a card counts as leaf (fs in sh_scene.js)
const LEAFK = QL(1, 1, 0.74), LEAFT = QL(0, 0, 0.1);
// Low draws leaves in two steps that must agree on depth exactly (W_GBUF_LOW in sh_scene.js)
const INV = LV > 1 ? '@invariant ' : '';
// the sea's mesh: this many times coarser (meshSea, and the swell's fade in the vertex shader)
const SEAK = QL(1, 1, 2);
// textures baked at load: leaf atlas tile, noise tiles, ground maps, sky-visibility map, wave tile
const LEAFPX = QL(512, 512, 256), NOISEPX = QL(1024, 1024, 512), MAPPX = QL(2048, 2048, 1024), TOPPX = QL(2048, 1024, 1024), WAVEPX = QL(512, 512, 128);
const TOPL = Math.log2(2048 / TOPPX); // mip levels the sky-visibility map is short of full size
// per-frame passes: canal mirror, SSAO, light shafts, polished-stone reflections, bloom depth
const MIRROR = LV < 2, SSAO = LV < 2, SHAFTS = LV < 2, POLISH = LV < 2, NBLOOM = QL(6, 6, 4);
// screen-space reflection march steps (Medium takes fewer, longer ones)
const SSRN = QL(22, 14, 14);
