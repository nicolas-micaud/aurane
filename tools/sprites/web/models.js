/* global document */
// Stylised 3D models built from primitives, detailed enough to read at 24 px and to reward a
// zoom: plated hulls, greebles, trusses, window strips, engine nozzles, faction lights.
// Each builder returns a THREE.Group; meshes with userData.team = true carry the faction
// colour (rendered to a separate "lights" sheet and tinted in the client).
// Heading is +X. Up is +Y. The renderer fits each model to its frame.
import * as THREE from 'three';

// --- deterministic randomness, so a sheet never changes between two renders ------------------
let seed = 7;
const srand = (s) => { seed = s >>> 0 || 1; };
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// --- procedural plating texture: seams, panels of two greys, rivets ------------------------------
function platingTexture(base = '#a8b2c2', dark = '#8e99aa', size = 256, cells = 6) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  const cell = size / cells;
  srand(size * 31 + cells * 7 + base.length);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    if (rnd() < 0.35) { ctx.fillStyle = dark; ctx.globalAlpha = 0.5 + rnd() * 0.4; ctx.fillRect(x * cell, y * cell, cell, cell); ctx.globalAlpha = 1; }
    if (rnd() < 0.25) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x * cell + 2, y * cell + 2, cell * 0.5, cell * 0.3); }
  }
  ctx.strokeStyle = 'rgba(10,14,24,0.65)'; ctx.lineWidth = 2;
  for (let i = 0; i <= cells; i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) { ctx.fillRect(x * cell + 4, y * cell + 4, 2, 2); ctx.fillRect((x + 1) * cell - 6, (y + 1) * cell - 6, 2, 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function roughnessTexture(size = 256, cells = 6) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, size, size);
  const cell = size / cells; srand(99);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) { ctx.fillStyle = `rgb(${110 + Math.floor(rnd() * 70)},0,0)`; ctx.fillStyle = `hsl(0,0%,${40 + rnd() * 30}%)`; ctx.fillRect(x * cell, y * cell, cell, cell); }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  for (let i = 0; i <= cells; i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex;
}

const PLATE = platingTexture('#8e99ab', '#6f7a8c');
const PLATE_DARK = platingTexture('#3f4858', '#2e3543', 256, 5);
const PLATE_PALE = platingTexture('#cfd5de', '#aeb6c3', 256, 5);
const ROUGH = roughnessTexture();

export const HULL = new THREE.MeshStandardMaterial({ map: PLATE, roughnessMap: ROUGH, metalness: 0.62, roughness: 0.5 });
export const HULL_DARK = new THREE.MeshStandardMaterial({ map: PLATE_DARK, roughnessMap: ROUGH, metalness: 0.75, roughness: 0.55 });
export const HULL_PALE = new THREE.MeshStandardMaterial({ map: PLATE_PALE, roughnessMap: ROUGH, metalness: 0.35, roughness: 0.6 });
export const GOLD = new THREE.MeshStandardMaterial({ color: 0xd9b46a, metalness: 0.9, roughness: 0.3 });
export const GUN = new THREE.MeshStandardMaterial({ color: 0x2b313d, metalness: 0.85, roughness: 0.4 });
export const GLASS = new THREE.MeshStandardMaterial({ color: 0x6fb8ff, metalness: 0.1, roughness: 0.08, emissive: 0x1f4f8a, emissiveIntensity: 0.8 });
export const PANEL = new THREE.MeshStandardMaterial({ color: 0x17305c, metalness: 0.5, roughness: 0.25 });
export const PANEL_FRAME = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 0.7, roughness: 0.4 });
export const WINDOW = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe6b0, emissiveIntensity: 1.4, metalness: 0, roughness: 1 });
export const TEAM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.3, metalness: 0, roughness: 1 });
/** What a team part looks like on the base sheet: a dark matte slot the tinted lights sit in. */
export const TEAM_BASE = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.3, roughness: 0.8 });
export const ENGINE = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.8, metalness: 0, roughness: 1 });
export const RUST = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, metalness: 0.4, roughness: 0.8 });

// --- primitives ------------------------------------------------------------------------------
const mesh = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], team = false) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot);
  m.userData.team = team; m.castShadow = true; m.receiveShadow = true;
  return m;
};
const box = (w, h, d, mat = HULL, pos, rot, team) => mesh(new THREE.BoxGeometry(w, h, d), mat, pos, rot, team);
const cyl = (rt, rb, h, mat = HULL, pos, rot, seg = 24, team) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, pos, rot, team);
const sphere = (r, mat = HULL, pos, seg = 24, team) => mesh(new THREE.SphereGeometry(r, seg, seg), mat, pos, [0, 0, 0], team);
const torus = (r, t, mat = HULL, pos, rot, team, seg = 64) => mesh(new THREE.TorusGeometry(r, t, 14, seg), mat, pos, rot, team);
const cone = (r, h, mat = HULL, pos, rot, seg = 24, team) => mesh(new THREE.ConeGeometry(r, h, seg), mat, pos, rot, team);
const hexPrism = (r, h, mat = HULL, pos, rot, team) => mesh(new THREE.CylinderGeometry(r, r, h, 6), mat, pos, rot, team);
const octa = (r, mat = HULL, pos) => mesh(new THREE.OctahedronGeometry(r), mat, pos);
const group = (...children) => { const g = new THREE.Group(); for (const c of children) if (c) g.add(c); return g; };
const at = (g, x, y, z, ry = 0) => { g.position.set(x, y, z); g.rotation.y = ry; return g; };

/** A wedge hull pointing +X with a bevelled edge. */
function wedge(l, w, h, mat = HULL, notch = 0.12) {
  const shape = new THREE.Shape();
  shape.moveTo(l / 2, 0); shape.lineTo(l * 0.1, w / 2); shape.lineTo(-l / 2, w * 0.42); shape.lineTo(-l / 2 + l * notch, 0); shape.lineTo(-l / 2, -w * 0.42); shape.lineTo(l * 0.1, -w / 2); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: h * 0.22, bevelSize: w * 0.05, bevelSegments: 3 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -h / 2; m.castShadow = m.receiveShadow = true;
  return m;
}
/** Random small boxes on a surface patch (centre, extents), for mechanical texture. */
function greebles(n, cx, cy, cz, ex, ez, s = 0.18, mat = HULL_DARK) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const w = s * (0.5 + rnd()), d = s * (0.5 + rnd()), h = s * (0.2 + rnd() * 0.8);
    g.add(box(w, h, d, rnd() < 0.2 ? GUN : mat, [cx + (rnd() - 0.5) * 2 * ex, cy + h / 2, cz + (rnd() - 0.5) * 2 * ez]));
  }
  return g;
}
/** A row of lit windows along +x, on a face at (cx, cy, cz), facing dir ('z' or '-z' or 'y'). */
function windows(n, cx, cy, cz, len, dir = 'z', w = 0.16, h = 0.08) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = cx - len / 2 + (i + 0.5) * (len / n);
    if (dir === 'y') g.add(box(w, 0.02, h, WINDOW, [x, cy, cz]));
    else g.add(box(w, h, 0.02, WINDOW, [x, cy, cz]));
  }
  return g;
}
/** Lattice truss along +x: four chords and diagonals. */
function truss(len, size, mat = HULL_DARK, bays = null) {
  const g = new THREE.Group();
  const t = size * 0.12;
  const half = size / 2;
  for (const [y, z] of [[half, half], [half, -half], [-half, half], [-half, -half]]) g.add(box(len, t, t, mat, [0, y, z]));
  const n = bays ?? Math.max(2, Math.round(len / size));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i * len) / n;
    g.add(box(t, size, t, mat, [x, 0, half])); g.add(box(t, size, t, mat, [x, 0, -half]));
    g.add(box(t, t, size, mat, [x, half, 0])); g.add(box(t, t, size, mat, [x, -half, 0]));
    if (i < n) { const dl = Math.hypot(len / n, size); g.add(box(dl, t * 0.8, t * 0.8, mat, [x + len / n / 2, 0, half], [0, 0, Math.atan2(size, len / n) * (i % 2 ? 1 : -1)])); g.add(box(dl, t * 0.8, t * 0.8, mat, [x + len / n / 2, 0, -half], [0, 0, Math.atan2(size, len / n) * (i % 2 ? -1 : 1)])); }
  }
  return g;
}
/** Solar array: framed panel with cell grid, facing +y, spanning +x. */
function solar(len, wid, mat = PANEL) {
  const g = group(box(len, 0.06, wid, mat, [0, 0, 0]), box(len, 0.1, 0.08, PANEL_FRAME, [0, 0, wid / 2]), box(len, 0.1, 0.08, PANEL_FRAME, [0, 0, -wid / 2]), box(0.08, 0.1, wid, PANEL_FRAME, [len / 2, 0, 0]), box(0.08, 0.1, wid, PANEL_FRAME, [-len / 2, 0, 0]));
  const cells = Math.max(2, Math.round(len / 0.6));
  for (let i = 1; i < cells; i++) g.add(box(0.03, 0.08, wid, PANEL_FRAME, [-len / 2 + (i * len) / cells, 0, 0]));
  g.add(box(len, 0.08, 0.03, PANEL_FRAME, [0, 0, 0]));
  return g;
}
/** Engine: housing, nozzle cone, glowing core and a team ring. */
function engine(r, pos) {
  const g = group(
    cyl(r * 1.15, r * 1.05, r * 1.6, HULL_DARK, [0, 0, 0], [0, 0, Math.PI / 2]),
    cyl(r * 0.85, r * 1.25, r * 0.9, GUN, [-r * 1.1, 0, 0], [0, 0, Math.PI / 2], 24),
    cyl(r * 0.55, r * 0.95, r * 0.5, ENGINE, [-r * 1.45, 0, 0], [0, 0, Math.PI / 2], 24, true),
    torus(r * 1.16, r * 0.06, TEAM, [r * 0.3, 0, 0], [0, Math.PI / 2, 0], true, 32),
  );
  return at(g, ...pos);
}
/** Gun barrel with muzzle brake, pointing +x from pos. */
function barrel(len, r, pos, mat = GUN) {
  return at(group(cyl(r, r * 1.15, len, mat, [len / 2, 0, 0], [0, 0, Math.PI / 2], 16), cyl(r * 1.5, r * 1.5, r * 3, mat, [len - r * 1.5, 0, 0], [0, 0, Math.PI / 2], 16), cyl(r * 1.35, r * 1.35, len * 0.25, HULL_DARK, [len * 0.15, 0, 0], [0, 0, Math.PI / 2], 16)), ...pos);
}
/** Faction stripe: a flush emissive band. */
const stripe = (l, w, pos, rot = [0, 0, 0]) => box(l, 0.05, w, TEAM, pos, rot, true);
/** Antenna spike with a tip light. */
const spike = (h, pos, team = true) => at(group(cyl(0.03, 0.05, h, GUN, [0, h / 2, 0]), sphere(0.07, team ? TEAM : WINDOW, [0, h, 0], 8, team)), ...pos);
/** Docking pad: a flat ring with guide lights. */
function pad(r, pos) {
  const g = group(cyl(r, r, 0.12, HULL_DARK, [0, 0, 0], [0, 0, 0], 16), torus(r * 0.85, 0.03, WINDOW, [0, 0.07, 0], [Math.PI / 2, 0, 0], false, 32));
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; g.add(sphere(0.05, TEAM, [Math.cos(a) * r * 0.6, 0.08, Math.sin(a) * r * 0.6], 8, true)); }
  return at(g, ...pos);
}

// --- models ----------------------------------------------------------------------------------
export const MODELS = {
  corvette() {
    srand(11);
    return group(
      wedge(3.6, 1.3, 0.5),
      box(1.1, 0.34, 0.6, HULL_DARK, [-0.2, 0.36, 0]),
      box(0.5, 0.22, 0.42, GLASS, [0.45, 0.5, 0]),
      // Swept fins with team edges
      box(1.3, 0.06, 0.55, HULL_DARK, [-1.15, 0.05, 0.75], [0, 0.35, 0]), box(1.3, 0.06, 0.55, HULL_DARK, [-1.15, 0.05, -0.75], [0, -0.35, 0]),
      stripe(1.1, 0.08, [-1.15, 0.09, 0.98], [0, 0.35, 0]), stripe(1.1, 0.08, [-1.15, 0.09, -0.98], [0, -0.35, 0]),
      engine(0.16, [-1.75, 0, 0.42]), engine(0.16, [-1.75, 0, -0.42]),
      barrel(0.9, 0.035, [0.9, 0.12, 0.22]), barrel(0.9, 0.035, [0.9, 0.12, -0.22]),
      greebles(6, -0.6, 0.53, 0, 0.35, 0.22, 0.12),
      stripe(0.9, 0.1, [0.3, 0.27, 0.32]), stripe(0.9, 0.1, [0.3, 0.27, -0.32]),
      spike(0.35, [-0.7, 0.53, 0]),
    );
  },
  frigate() {
    srand(23);
    return group(
      wedge(5.6, 2.1, 0.8),
      box(2.4, 0.5, 1.2, HULL_DARK, [-0.5, 0.6, 0]),
      box(1.0, 0.4, 0.9, HULL, [-0.2, 1.05, 0]),
      box(0.5, 0.3, 0.6, GLASS, [0.35, 1.2, 0]),
      windows(5, -0.7, 0.62, 0.61, 1.8), windows(5, -0.7, 0.62, -0.61, 1.8),
      // Nacelles on pylons
      box(0.8, 0.12, 0.7, HULL_DARK, [-1.0, 0.0, 0.95]), box(0.8, 0.12, 0.7, HULL_DARK, [-1.0, 0.0, -0.95]),
      cyl(0.3, 0.34, 3.0, HULL, [-1.2, 0, 1.25], [0, 0, Math.PI / 2]), cyl(0.3, 0.34, 3.0, HULL, [-1.2, 0, -1.25], [0, 0, Math.PI / 2]),
      engine(0.28, [-2.9, 0, 1.25]), engine(0.28, [-2.9, 0, -1.25]),
      stripe(2.4, 0.12, [-1.2, 0.35, 1.25]), stripe(2.4, 0.12, [-1.2, 0.35, -1.25]),
      // Forward turret and missile racks
      at(group(cyl(0.3, 0.34, 0.25, HULL_DARK, [0, 0, 0]), barrel(0.9, 0.05, [0.1, 0.15, 0.1]), barrel(0.9, 0.05, [0.1, 0.15, -0.1])), 1.4, 0.45, 0),
      box(0.8, 0.25, 0.3, GUN, [0.2, 0.55, 0.75]), box(0.8, 0.25, 0.3, GUN, [0.2, 0.55, -0.75]),
      greebles(10, -1.3, 0.85, 0, 0.7, 0.45, 0.16),
      stripe(2.0, 0.16, [0.4, 0.41, 0.7]), stripe(2.0, 0.16, [0.4, 0.41, -0.7]),
      spike(0.6, [-1.4, 1.25, 0.2]), spike(0.4, [-1.2, 1.25, -0.25], false),
    );
  },
  cruiser() {
    srand(37);
    const g = group(
      wedge(10.0, 2.8, 1.3),
      // Spine and superstructure
      box(5.0, 0.7, 1.9, HULL_DARK, [-1.0, 0.95, 0]),
      box(2.4, 0.7, 1.3, HULL, [-1.6, 1.6, 0]),
      box(1.2, 0.6, 1.0, HULL_PALE, [-2.4, 2.2, 0]),
      box(0.7, 0.35, 0.8, GLASS, [-1.9, 2.75, 0]),
      windows(8, -1.0, 0.95, 0.96, 4.4, 'z', 0.2, 0.1), windows(8, -1.0, 0.95, -0.96, 4.4, 'z', 0.2, 0.1),
      windows(4, -1.6, 1.6, 0.66, 2.0), windows(4, -1.6, 1.6, -0.66, 2.0),
      // Wing bar, nacelles, engines
      box(2.8, 0.5, 5.6, HULL_DARK, [-2.6, 0, 0]),
      stripe(2.4, 0.3, [-2.6, 0.26, 2.2]), stripe(2.4, 0.3, [-2.6, 0.26, -2.2]),
      cyl(0.55, 0.62, 4.8, HULL, [-2.6, 0, 2.6], [0, 0, Math.PI / 2]), cyl(0.55, 0.62, 4.8, HULL, [-2.6, 0, -2.6], [0, 0, Math.PI / 2]),
      engine(0.5, [-5.2, 0, 2.6]), engine(0.5, [-5.2, 0, -2.6]), engine(0.36, [-5.0, 0.3, 0]),
      // Spinal guns and turrets
      barrel(3.2, 0.09, [2.0, 0.55, 0.5]), barrel(3.2, 0.09, [2.0, 0.55, -0.5]),
      box(1.2, 0.5, 1.6, HULL_DARK, [1.2, 0.55, 0]),
    );
    for (const [x, z] of [[0.6, 1.1], [0.6, -1.1], [-1.2, 1.25], [-1.2, -1.25]]) g.add(at(group(cyl(0.32, 0.36, 0.28, HULL_DARK, [0, 0, 0]), barrel(1.0, 0.05, [0.1, 0.16, 0.12]), barrel(1.0, 0.05, [0.1, 0.16, -0.12])), x, 1.35, z, z > 0 ? 0.4 : -0.4));
    g.add(greebles(18, -0.8, 1.3, 0, 2.2, 0.8, 0.2));
    g.add(greebles(8, 1.5, 0.66, 0, 1.2, 0.9, 0.14));
    g.add(stripe(4.5, 0.22, [0.8, 0.66, 1.05])); g.add(stripe(4.5, 0.22, [0.8, 0.66, -1.05]));
    g.add(stripe(1.6, 0.3, [-1.6, 1.96, 0]));
    g.add(spike(1.0, [-3.0, 2.5, 0.3])); g.add(spike(0.7, [-3.2, 2.5, -0.3], false));
    for (let i = 0; i < 3; i++) g.add(box(0.5, 0.12, 0.5, PANEL, [-3.6 + i * 0.7, 1.32, 0], [0, 0, 0]));
    return g;
  },
  cargo() {
    srand(41);
    const g = group(
      box(4.6, 1.3, 1.9, HULL_DARK, [-0.5, 0, 0]),
      truss(4.2, 1.5, HULL_DARK, 4),
      box(1.3, 1.1, 1.5, HULL, [2.0, 0.05, 0]),
      box(0.6, 0.45, 1.0, GLASS, [2.55, 0.45, 0]),
      windows(3, 2.0, 0.1, 0.76, 1.0), windows(3, 2.0, 0.1, -0.76, 1.0),
      engine(0.3, [-3.0, 0.1, 0.65]), engine(0.3, [-3.0, 0.1, -0.65]),
      box(0.3, 1.4, 1.9, HULL, [-2.5, 0.1, 0]),
      stripe(1.0, 0.4, [2.0, 0.61, 0]),
    );
    // Containers in two rows, clamped by the truss
    for (let i = 0; i < 3; i++) for (const z of [0.55, -0.55]) {
      const mat = i === 1 ? RUST : HULL_PALE;
      g.add(box(1.15, 0.9, 0.95, mat, [-1.7 + i * 1.25, 0.95, z]));
      g.add(box(1.17, 0.08, 0.97, HULL_DARK, [-1.7 + i * 1.25, 1.42, z]));
      g.add(stripe(0.9, 0.12, [-1.7 + i * 1.25, 1.47, z]));
    }
    g.add(greebles(6, 2.0, 0.6, 0, 0.5, 0.6, 0.12));
    g.add(spike(0.5, [1.6, 0.6, 0.6]));
    return g;
  },
  station() {
    srand(53);
    const g = group(
      // Hub: stacked hex tiers with window bands
      hexPrism(2.4, 1.4, HULL_PALE, [0, 0, 0], [0, Math.PI / 6, 0]),
      hexPrism(1.9, 2.4, HULL, [0, 0, 0], [0, Math.PI / 6, 0]),
      hexPrism(1.3, 3.4, HULL_DARK, [0, 0, 0], [0, Math.PI / 6, 0]),
      torus(2.45, 0.05, WINDOW, [0, 0.35, 0], [Math.PI / 2, 0, 0], false, 6),
      torus(1.95, 0.05, WINDOW, [0, 0.9, 0], [Math.PI / 2, 0, 0], false, 6),
      torus(2.45, 0.08, TEAM, [0, -0.5, 0], [Math.PI / 2, 0, 0], true, 6),
      // Habitat ring: segmented modules on a thick torus
      torus(5.4, 0.38, HULL, [0, 0, 0], [Math.PI / 2, 0, 0], false, 96),
      torus(5.4, 0.12, TEAM, [0, 0.3, 0], [Math.PI / 2, 0, 0], true, 96),
      torus(5.4, 0.08, WINDOW, [0, -0.25, 0], [Math.PI / 2, 0, 0], false, 96),
      // Comm tower and reactor below
      cyl(0.22, 0.3, 4.2, GOLD, [0, 3.2, 0]),
      octa(0.5, GLASS, [0, 5.6, 0]),
      sphere(0.28, TEAM, [0, 6.3, 0], 12, true),
      cyl(0.9, 1.2, 1.6, HULL_DARK, [0, -2.4, 0]),
      sphere(1.0, GUN, [0, -3.5, 0], 24),
      torus(1.05, 0.06, TEAM, [0, -3.5, 0], [Math.PI / 2, 0, 0], true, 48),
    );
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI * 2) / 12;
      g.add(box(1.3, 0.9, 0.9, i % 3 === 0 ? HULL_PALE : HULL_DARK, [Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4], [0, -a, 0]));
      if (i % 3 === 1) g.add(pad(0.55, [Math.cos(a) * 5.4, 0.5, Math.sin(a) * 5.4]));
    }
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      g.add(at(truss(3.2, 0.7, HULL_DARK, 4), Math.cos(a) * 3.8, 0, Math.sin(a) * 3.8, -a));
      g.add(box(1.0, 1.4, 1.0, HULL, [Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4], [0, -a, 0]));
      g.add(at(solar(3.0, 1.5), Math.cos(a) * 7.0, 0.2, Math.sin(a) * 7.0, -a + Math.PI / 2));
      g.add(box(0.12, 0.12, 1.2, PANEL_FRAME, [Math.cos(a) * 6.3, 0.2, Math.sin(a) * 6.3], [0, -a, 0]));
      const b = a + Math.PI / 3;
      g.add(at(group(box(2.0, 0.25, 0.4, HULL_DARK, [1.0, 0, 0]), pad(0.45, [2.2, 0.15, 0])), Math.cos(b) * 2.4, 0.8, Math.sin(b) * 2.4, -b));
    }
    g.add(greebles(16, 0, 0.7, 0, 1.6, 1.6, 0.25));
    g.add(spike(1.2, [1.0, 1.2, 1.0])); g.add(spike(0.8, [-1.1, 1.2, 0.9], false));
    return g;
  },
  relay() {
    srand(61);
    const dish = group(
      mesh(new THREE.SphereGeometry(1.7, 32, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), HULL_PALE, [0, 0, 0], [Math.PI, 0, 0]),
      torus(1.55, 0.05, TEAM, [0, 0.3, 0], [Math.PI / 2, 0, 0], true, 48),
      cyl(0.04, 0.04, 1.6, GUN, [0, 1.0, 0]),
      sphere(0.14, WINDOW, [0, 1.85, 0], 10),
    );
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; dish.add(box(1.6, 0.05, 0.06, PANEL_FRAME, [Math.cos(a) * 0.85, 0.05, Math.sin(a) * 0.85], [0, -a, 0.35])); }
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; dish.add(cyl(0.02, 0.02, 1.9, GUN, [Math.cos(a) * 0.7, 0.9, Math.sin(a) * 0.7], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4])); }
    return group(
      hexPrism(1.1, 0.5, HULL_DARK, [0, -0.9, 0]),
      box(0.9, 0.9, 0.9, HULL, [0, -0.3, 0]),
      windows(3, 0, -0.3, 0.46, 0.7), windows(3, 0, -0.3, -0.46, 0.7),
      cyl(0.16, 0.22, 1.6, HULL_DARK, [0, 0.7, 0]),
      at(dish, 0, 1.5, 0),
      at(solar(2.6, 1.0), -1.9, 0.1, 0, 0), at(solar(2.6, 1.0), 1.9, 0.1, 0, 0),
      box(1.2, 0.08, 0.08, PANEL_FRAME, [-0.9, 0.1, 0]), box(1.2, 0.08, 0.08, PANEL_FRAME, [0.9, 0.1, 0]),
      sphere(0.35, GUN, [0, -1.5, 0], 16), torus(0.38, 0.04, TEAM, [0, -1.5, 0], [Math.PI / 2, 0, 0], true, 32),
      greebles(6, 0, 0.15, 0, 0.35, 0.35, 0.12),
    );
  },
  turret_light() {
    srand(71);
    return group(
      hexPrism(1.3, 0.5, HULL_DARK, [0, -0.35, 0]),
      cyl(0.95, 1.1, 0.25, HULL, [0, 0.0, 0], [0, 0, 0], 12),
      torus(1.0, 0.04, TEAM, [0, 0.13, 0], [Math.PI / 2, 0, 0], true, 32),
      cyl(0.55, 0.65, 0.5, HULL_DARK, [0, 0.35, 0], [0, 0, 0], 16),
      box(1.2, 0.6, 0.9, HULL_PALE, [0.15, 0.9, 0]),
      box(0.5, 0.2, 0.3, GLASS, [-0.2, 1.3, 0.2]),
      barrel(1.6, 0.05, [0.6, 0.95, 0.18]), barrel(1.6, 0.05, [0.6, 0.95, -0.18]),
      box(0.4, 0.3, 0.2, GUN, [0.3, 1.0, 0.55]), box(0.4, 0.3, 0.2, GUN, [0.3, 1.0, -0.55]),
      stripe(0.8, 0.4, [0.0, 1.21, 0]),
      greebles(5, -0.3, 1.2, 0, 0.25, 0.3, 0.1),
      spike(0.5, [-0.45, 1.2, -0.3]),
    );
  },
  turret_heavy() {
    srand(73);
    return group(
      hexPrism(1.9, 0.7, HULL_DARK, [0, -0.5, 0]),
      hexPrism(1.5, 0.3, HULL, [0, 0.0, 0]),
      torus(1.55, 0.05, TEAM, [0, 0.16, 0], [Math.PI / 2, 0, 0], true, 6),
      cyl(0.95, 1.05, 0.8, HULL_DARK, [0, 0.55, 0], [0, 0, 0], 16),
      box(2.0, 1.1, 1.6, HULL_PALE, [0.2, 1.4, 0]),
      box(1.0, 0.3, 1.7, HULL_DARK, [-0.4, 2.0, 0]),
      barrel(2.8, 0.14, [1.1, 1.5, 0.45]), barrel(2.8, 0.14, [1.1, 1.5, -0.45]),
      box(0.6, 0.5, 0.35, GUN, [0.4, 1.4, 0.95]), box(0.6, 0.5, 0.35, GUN, [0.4, 1.4, -0.95]),
      box(0.5, 0.25, 0.4, GLASS, [-0.6, 2.25, 0.4]),
      stripe(1.4, 0.7, [0.1, 1.96, 0]),
      greebles(8, -0.5, 1.96, 0, 0.4, 0.6, 0.14),
      spike(0.7, [-0.9, 2.15, -0.5]),
    );
  },
  launcher() {
    srand(79);
    const g = group(
      box(2.8, 0.5, 2.4, HULL_DARK, [0, -0.35, 0]),
      box(2.4, 0.3, 2.0, HULL, [0, 0.05, 0]),
      // VLS block, tilted forward
      at(group(box(1.8, 1.1, 1.6, HULL_PALE, [0, 0.55, 0]), box(1.82, 0.12, 1.62, HULL_DARK, [0, 1.15, 0])), 0.1, 0.2, 0, 0),
      // Radar dome and sensor mast
      sphere(0.4, HULL_PALE, [-1.0, 0.7, 0.7], 16), torus(0.42, 0.03, TEAM, [-1.0, 0.7, 0.7], [Math.PI / 2, 0, 0], true, 32),
      spike(0.9, [-1.0, 0.6, -0.7]),
      stripe(1.6, 0.14, [0.1, 1.42, 0.7]), stripe(1.6, 0.14, [0.1, 1.42, -0.7]),
    );
    const block = new THREE.Group(); block.position.set(0.1, 0.2, 0); block.rotation.z = 0.32;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) block.add(cyl(0.15, 0.15, 0.2, GUN, [-0.55 + c * 0.37, 1.22, -0.55 + r * 0.37], [0, 0, 0], 12));
    block.add(box(1.8, 1.1, 1.6, HULL_PALE, [0, 0.55, 0])); block.add(box(1.84, 0.1, 1.64, HULL_DARK, [0, 1.12, 0]));
    g.children.splice(2, 1); g.add(block);
    g.add(greebles(6, -0.9, 0.2, 0, 0.3, 0.9, 0.12));
    return g;
  },
  bastion() {
    srand(83);
    const g = group(
      hexPrism(3.0, 0.8, HULL_DARK, [0, -0.6, 0]),
      hexPrism(2.6, 0.3, HULL, [0, -0.05, 0]),
      torus(2.65, 0.06, TEAM, [0, 0.12, 0], [Math.PI / 2, 0, 0], true, 6),
      mesh(new THREE.IcosahedronGeometry(1.9, 1), HULL_PALE, [0, 0.1, 0]),
      mesh(new THREE.IcosahedronGeometry(1.94, 1), new THREE.MeshStandardMaterial({ color: 0x3a4557, wireframe: true }), [0, 0.1, 0]),
      sphere(0.5, GLASS, [0, 2.05, 0], 16),
      torus(0.55, 0.05, TEAM, [0, 2.05, 0], [Math.PI / 2, 0, 0], true, 32),
    );
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + 0.4;
      g.add(cyl(0.16, 0.26, 2.6, GOLD, [Math.cos(a) * 2.6, 0.7, Math.sin(a) * 2.6]));
      g.add(octa(0.3, GLASS, [Math.cos(a) * 2.6, 2.2, Math.sin(a) * 2.6]));
      g.add(sphere(0.12, TEAM, [Math.cos(a) * 2.6, 2.6, Math.sin(a) * 2.6], 8, true));
      g.add(box(1.2, 0.3, 0.5, HULL_DARK, [Math.cos(a + 1.05) * 2.2, 0.15, Math.sin(a + 1.05) * 2.2], [0, -(a + 1.05), 0]));
    }
    g.add(greebles(10, 0, 0.1, 0, 2.4, 2.4, 0.16));
    return g;
  },
  extractor() {
    srand(89);
    const g = group(
      hexPrism(1.6, 0.4, HULL_DARK, [0, -0.7, 0]),
      // Derrick: truss tower
      at(truss(3.6, 0.9, HULL_DARK, 5), 0, 1.1, 0), // along x; rotate to vertical below
      cyl(0.32, 0.22, 2.2, GUN, [0, -1.6, 0], [0, 0, 0], 12),
      cone(0.3, 0.6, GUN, [0, -2.9, 0], [Math.PI, 0, 0], 12),
      box(0.9, 0.7, 0.9, HULL_PALE, [0, 3.1, 0]),
      sphere(0.15, TEAM, [0, 3.6, 0], 8, true),
    );
    g.children[1].rotation.z = Math.PI / 2; g.children[1].position.set(0, 1.1, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      g.add(cyl(0.62, 0.62, 1.3, HULL_PALE, [Math.cos(a) * 1.7, -0.1, Math.sin(a) * 1.7]));
      g.add(cyl(0.64, 0.64, 0.08, HULL_DARK, [Math.cos(a) * 1.7, 0.2, Math.sin(a) * 1.7]));
      g.add(stripe(0.5, 0.5, [Math.cos(a) * 1.7, 0.56, Math.sin(a) * 1.7]));
      g.add(cyl(0.07, 0.07, 1.4, GUN, [Math.cos(a) * 0.9, -0.4, Math.sin(a) * 0.9], [0, 0, 0]));
      g.add(cyl(0.07, 0.07, 1.6, GUN, [Math.cos(a) * 1.0, -0.5, Math.sin(a) * 1.0], [Math.sin(a) * 1.57, 0, -Math.cos(a) * 1.57]));
      g.add(cyl(0.1, 0.16, 2.4, GOLD, [Math.cos(a + 1.05) * 1.3, 0.4, Math.sin(a + 1.05) * 1.3], [Math.sin(a + 1.05) * 0.45, 0, -Math.cos(a + 1.05) * 0.45]));
    }
    g.add(box(1.4, 0.5, 0.7, HULL, [-1.1, 0.0, -1.5]));
    g.add(windows(3, -1.1, 0.05, -1.14, 1.0));
    g.add(greebles(8, 0, -0.5, 0, 1.2, 1.2, 0.14));
    return g;
  },
  warehouse() {
    srand(97);
    const g = group(box(5.0, 0.4, 3.4, HULL_DARK, [0, -0.7, 0]), box(4.6, 0.1, 3.0, HULL, [0, -0.45, 0]));
    for (let i = 0; i < 3; i++) {
      const x = -1.5 + i * 1.5;
      g.add(cyl(0.72, 0.72, 2.2, HULL_PALE, [x, 0.6, 0.3]));
      g.add(mesh(new THREE.SphereGeometry(0.72, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), HULL, [x, 1.7, 0.3]));
      g.add(torus(0.74, 0.04, HULL_DARK, [x, 1.2, 0.3], [Math.PI / 2, 0, 0], false, 32));
      g.add(stripe(1.2, 0.1, [x, 0.9, 1.03], [Math.PI / 2, 0, 0]));
      g.add(cyl(0.06, 0.06, 1.3, GUN, [x, 1.3, 1.0]));
    }
    // Gantry crane over container rows
    g.add(box(0.15, 1.6, 0.15, HULL_DARK, [-2.2, 0.4, -1.3])); g.add(box(0.15, 1.6, 0.15, HULL_DARK, [2.2, 0.4, -1.3]));
    g.add(at(truss(4.6, 0.3, HULL_DARK, 8), 0, 1.25, -1.3));
    g.add(box(0.5, 0.3, 0.4, GOLD, [0.6, 1.0, -1.3]));
    for (let i = 0; i < 4; i++) { g.add(box(0.9, 0.55, 0.6, i % 2 ? RUST : HULL_PALE, [-1.7 + i * 1.15, -0.1, -1.3])); g.add(stripe(0.7, 0.1, [-1.7 + i * 1.15, 0.18, -1.3])); }
    g.add(box(1.0, 0.7, 0.8, HULL, [2.0, -0.1, 0.6])); g.add(windows(2, 2.0, -0.05, 1.01, 0.7));
    g.add(greebles(6, 0, -0.4, 0.9, 2.0, 0.3, 0.12));
    g.add(spike(0.7, [-2.2, 0.0, 0.9]));
    return g;
  },
  shipyard() {
    srand(101);
    const g = group(
      // Dock rails and base
      box(7.6, 0.5, 0.7, HULL_DARK, [0, -0.2, 2.0]), box(7.6, 0.5, 0.7, HULL_DARK, [0, -0.2, -2.0]),
      box(0.7, 0.5, 4.7, HULL_DARK, [-3.4, -0.2, 0]),
      box(7.6, 0.08, 0.2, TEAM, [0, 0.07, 2.35], [0, 0, 0], true), box(7.6, 0.08, 0.2, TEAM, [0, 0.07, -2.35], [0, 0, 0], true),
      // Control tower
      box(1.6, 1.8, 1.4, HULL, [-3.2, 0.8, 2.6]),
      box(1.0, 0.5, 1.0, GLASS, [-3.2, 1.95, 2.6]),
      windows(4, -3.2, 0.8, 3.31, 1.3),
      // Hull under construction with scaffolding
      wedge(4.2, 1.6, 0.6, HULL_PALE),
      box(2.0, 0.5, 1.0, HULL_DARK, [-0.6, 0.5, 0]),
    );
    for (let i = 0; i < 5; i++) {
      const x = -2.8 + i * 1.5;
      g.add(at(truss(4.4, 0.35, HULL_DARK, 6), x, 1.7, 0, Math.PI / 2));
      g.add(box(0.3, 2.0, 0.3, HULL, [x, 0.8, 2.0])); g.add(box(0.3, 2.0, 0.3, HULL, [x, 0.8, -2.0]));
      g.add(box(0.4, 0.4, 0.5, GOLD, [x, 1.4, (i % 2 ? 0.6 : -0.6)]));
      g.add(sphere(0.06, TEAM, [x, 1.95, 2.0], 8, true)); g.add(sphere(0.06, TEAM, [x, 1.95, -2.0], 8, true));
    }
    for (let i = 0; i < 6; i++) g.add(box(0.06, 0.6, 0.06, GUN, [-1.5 + i * 0.7, 0.55, 0.9 * (i % 2 ? 1 : -1)]));
    g.add(greebles(10, 0, 0.05, 0, 3.4, 0.25, 0.14));
    g.add(spike(0.8, [-3.6, 2.2, 3.0]));
    return g;
  },
  antenna() {
    srand(103);
    const g = group(hexPrism(1.2, 0.4, HULL_DARK, [0, -0.6, 0]), box(0.9, 0.6, 0.9, HULL, [0, -0.1, 0]), windows(2, 0, -0.1, 0.46, 0.6));
    const mast = truss(5.6, 0.34, HULL_DARK, 12); mast.rotation.z = Math.PI / 2; mast.position.set(0, 2.9, 0); g.add(mast);
    g.add(sphere(0.16, TEAM, [0, 5.8, 0], 8, true));
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3; const y = 1.2 + i * 1.4;
      const d = group(mesh(new THREE.SphereGeometry(0.75, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3), HULL_PALE, [0, 0, 0], [Math.PI / 2 + 0.35, 0, 0]), cyl(0.03, 0.03, 0.8, GUN, [0, 0.1, 0.5], [Math.PI / 2 + 0.35, 0, 0]), sphere(0.06, WINDOW, [0, 0.15, 0.85], 8));
      g.add(at(d, Math.cos(a) * 0.55, y, Math.sin(a) * 0.55, -a + Math.PI / 2));
      g.add(box(0.5, 0.06, 0.06, GUN, [Math.cos(a) * 0.3, y - 0.2, Math.sin(a) * 0.3], [0, -a, 0]));
    }
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3 + 0.5; g.add(cyl(0.015, 0.015, 4.9, GUN, [Math.cos(a) * 0.8, 2.0, Math.sin(a) * 0.8], [Math.sin(a) * 0.33, 0, -Math.cos(a) * 0.33])); g.add(box(0.2, 0.15, 0.2, HULL_DARK, [Math.cos(a) * 1.5, -0.3, Math.sin(a) * 1.5])); }
    g.add(greebles(5, 0, 0.2, 0, 0.35, 0.35, 0.1));
    return g;
  },
  amplifier() {
    srand(107);
    const g = group(hexPrism(1.4, 0.4, HULL_DARK, [0, -0.6, 0]), cyl(0.7, 0.9, 0.6, HULL, [0, -0.1, 0], [0, 0, 0], 12), cyl(0.18, 0.24, 3.8, GOLD, [0, 1.4, 0]));
    for (let i = 0; i < 4; i++) {
      const y = 0.5 + i * 0.85, r = 1.4 - i * 0.22;
      g.add(torus(r, 0.1, HULL_PALE, [0, y, 0], [Math.PI / 2, 0, 0], false, 64));
      g.add(torus(r, 0.035, TEAM, [0, y + 0.09, 0], [Math.PI / 2, 0, 0], true, 64));
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3 + i * 0.26; g.add(box(0.12, 0.25, 0.12, HULL_DARK, [Math.cos(a) * r, y, Math.sin(a) * r])); }
      for (let k = 0; k < 3; k++) { const a = (k * Math.PI * 2) / 3 + i * 0.5; g.add(box(r, 0.04, 0.04, GUN, [Math.cos(a) * r / 2, y, Math.sin(a) * r / 2], [0, -a, 0])); }
    }
    g.add(octa(0.45, GLASS, [0, 3.5, 0])); g.add(sphere(0.12, TEAM, [0, 4.0, 0], 8, true));
    g.add(greebles(5, 0, 0.2, 0, 0.5, 0.5, 0.12));
    return g;
  },
  /** A broken warship: a torn hull section, exposed frames, dead engines, one lingering light. */
  wreck() {
    srand(113);
    const g = group(
      wedge(6.4, 2.2, 1.0, HULL_DARK),
      box(2.0, 0.6, 1.4, GUN, [-0.6, 0.75, 0]),
      // The prow is sheared off: frames sticking out
      box(0.12, 1.2, 0.12, RUST, [2.6, 0.2, 0.5]), box(0.12, 0.9, 0.12, RUST, [2.4, 0.1, -0.4]), box(1.2, 0.1, 0.1, RUST, [2.2, 0.6, 0.0], [0, 0, 0.5]),
      // Ribs along a torn flank
      cyl(0.36, 0.4, 3.0, GUN, [-1.4, 0, 1.5], [0, 0, Math.PI / 2]),
      cyl(0.3, 0.5, 0.6, GUN, [-3.0, 0, 1.5], [0, 0, Math.PI / 2], 16),
      box(0.8, 0.5, 0.5, RUST, [-2.0, -0.2, -1.4]),
      sphere(0.09, WINDOW, [-0.9, 1.1, 0.2], 8),
    );
    for (let i = 0; i < 5; i++) g.add(box(0.1, 0.7 + rnd() * 0.5, 0.1, RUST, [-2.2 + i * 0.7, 0.2, -1.1], [0, 0, (rnd() - 0.5) * 0.6]));
    g.add(greebles(14, -0.6, 0.5, 0, 2.2, 0.8, 0.2, GUN));
    // Debris drifting around the hull
    for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI * 2, r = 3.2 + rnd() * 1.4; g.add(box(0.2 + rnd() * 0.4, 0.1 + rnd() * 0.2, 0.2 + rnd() * 0.3, rnd() < 0.5 ? GUN : RUST, [Math.cos(a) * r, (rnd() - 0.5) * 0.8, Math.sin(a) * r], [rnd(), rnd(), rnd()])); }
    return g;
  },
  /** A dead station: dark hub, a missing ring section, panels hanging, no lights but one. */
  derelict() {
    srand(127);
    const g = group(
      hexPrism(2.0, 1.2, GUN, [0, 0, 0], [0, Math.PI / 6, 0]),
      hexPrism(1.3, 2.4, HULL_DARK, [0, 0, 0], [0, Math.PI / 6, 0]),
      mesh(new THREE.TorusGeometry(4.4, 0.34, 12, 64, Math.PI * 1.45), GUN, [0, 0, 0], [Math.PI / 2, 0, 0.6]),
      cyl(0.18, 0.24, 3.0, RUST, [0, 2.4, 0], [0.2, 0, 0.1]),
      sphere(0.18, WINDOW, [0, 3.9, 0.3], 8),
    );
    for (let i = 0; i < 8; i++) { const a = 0.6 + (i / 8) * Math.PI * 1.45; g.add(box(1.2, 0.8, 0.8, i % 3 ? GUN : RUST, [Math.cos(a) * 4.4, 0, -Math.sin(a) * 4.4], [0, a, 0])); }
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; g.add(at(truss(2.6, 0.6, GUN, 3), Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2, -a)); }
    g.add(at(solar(2.4, 1.2, new THREE.MeshStandardMaterial({ color: 0x1a2236, metalness: 0.4, roughness: 0.7 })), 5.4, -0.3, 1.2, 0.9));
    g.add(box(0.1, 0.1, 1.6, RUST, [5.0, -0.2, 0.6], [0.4, 0, 0]));
    g.add(greebles(10, 0, 0.6, 0, 1.4, 1.4, 0.22, GUN));
    return g;
  },
  tradepost() {
    srand(109);
    const g = group(
      cyl(2.4, 2.7, 0.5, HULL_DARK, [0, -0.6, 0], [0, 0, 0], 8),
      torus(2.55, 0.06, WINDOW, [0, -0.35, 0], [Math.PI / 2, 0, 0], false, 8),
      sphere(1.45, HULL_PALE, [0, 0.35, 0], 32),
      torus(1.47, 0.06, TEAM, [0, 0.35, 0], [Math.PI / 2, 0, 0], true, 64),
      torus(1.35, 0.05, WINDOW, [0, 0.85, 0], [Math.PI / 2, 0, 0], false, 64),
      sphere(0.8, HULL_PALE, [1.9, 0.0, 1.1], 20), sphere(0.7, HULL, [-1.6, 0.0, -1.5], 20),
      torus(0.82, 0.04, WINDOW, [1.9, 0.1, 1.1], [Math.PI / 2, 0, 0], false, 32),
      cyl(0.1, 0.14, 1.6, GOLD, [0, 2.4, 0]), sphere(0.16, TEAM, [0, 3.25, 0], 8, true),
    );
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      g.add(at(truss(2.4, 0.3, HULL_DARK, 5), Math.cos(a) * 2.6, -0.1, Math.sin(a) * 2.6, -a));
      g.add(pad(0.5, [Math.cos(a) * 4.0, -0.05, Math.sin(a) * 4.0]));
      for (let k = 0; k < 2; k++) g.add(box(0.5, 0.35, 0.35, k ? RUST : HULL_DARK, [Math.cos(a) * (3.0 + k * 0.6), 0.25, Math.sin(a) * (3.0 + k * 0.6)], [0, -a, 0]));
    }
    g.add(greebles(8, 0, -0.35, 0, 2.0, 2.0, 0.14));
    g.add(spike(0.6, [1.2, 0.9, -1.2], false));
    return g;
  },
};
