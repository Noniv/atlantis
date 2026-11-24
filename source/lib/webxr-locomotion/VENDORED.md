# webxr-locomotion (vendored)

The locomotion kit behind `xr.html`: teleport, jump, turn, walk and fly, and the wrist panel, for WebXR. It is plain
ES modules with no dependencies, MIT licensed (see `LICENSE`).

- **Origin:** the `webxr-locomotion` reference module by Michael Sitarzewski. It has its own spec and tests, and is not
  published as a package yet.
- **Copied:** `src/` as of 2026-11-21. This includes two changes found while bringing it to Atlantis:
  - a jump to a spot in the air or over water leaves you flying;
  - a music icon for the panel.
- **Built by:** `build.mjs --xr`, which bundles `src/index.js`, `src/xr/index.js` and `src/visuals/index.js` into one
  global, `LOCO`.

Change the kit at its origin, with a test, and copy `src/` here again. Don't edit it in place.
