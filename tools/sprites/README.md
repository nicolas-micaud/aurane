# Sprites — pre-rendered 3D for the System view

StarCraft's trick: 3D models rendered once into sprite sheets, drawn as 2D in the game.
`node tools/sprites/src/render.mjs` renders every model of `web/models.js` in headless Chromium
(three.js, no Blender, no GPU) into `apps/web/public/sprites/`:

- `<kind>.png` — 16 headings, 192 px each, base colours, lit and shadowed;
- `<kind>.lights.png` — the faction parts only, white on transparent, tinted in the client;
- `manifest.json` — frame size, per-model radius and camera elevation.

Ships are rendered from 38° (their profile reads), structures from 55° (their footprint reads).

## Replacing a model with a sculpted one

Drop `models/<kind>.glb` (glTF binary) next to this file and re-run the renderer: it is used
instead of the procedural model. Conventions:

- heading along **+X**, up along **+Y**, real proportions between kinds (a cruiser is ~3× a corvette);
- materials whose name contains `team` or `lights` receive the faction colour;
- keep silhouettes readable at 24 px: one strong shape, details on top.

`--only cruiser,station` renders a subset; `--icons 512 --team '#e8c872'` exports single
frames with a baked team colour to `apps/web/public/images/` for the showcase site.
