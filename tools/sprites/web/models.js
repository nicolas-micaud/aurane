// Stylised 3D models built from primitives: distinct silhouettes first, detail second.
// Each builder returns a THREE.Group whose meshes carry userData.team = true where the
// faction colour goes (rendered to a separate "lights" sheet, tinted in the client).
// Heading is +X. Up is +Y. Sizes are in metres-ish; the renderer fits each model to its frame.
import * as THREE from 'three';

export const HULL = new THREE.MeshStandardMaterial({ color: 0xaab4c4, metalness: 0.55, roughness: 0.42 });
export const HULL_DARK = new THREE.MeshStandardMaterial({ color: 0x4b5566, metalness: 0.7, roughness: 0.5 });
export const HULL_PALE = new THREE.MeshStandardMaterial({ color: 0xe6e9ef, metalness: 0.3, roughness: 0.55 });
export const GOLD = new THREE.MeshStandardMaterial({ color: 0xd9b46a, metalness: 0.8, roughness: 0.35 });
export const GLASS = new THREE.MeshStandardMaterial({ color: 0x86c9ff, metalness: 0.2, roughness: 0.1, emissive: 0x2a5d8f, emissiveIntensity: 0.6 });
export const PANEL = new THREE.MeshStandardMaterial({ color: 0x1f3a66, metalness: 0.4, roughness: 0.3 });
export const TEAM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, metalness: 0, roughness: 1 });
export const ENGINE = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6, metalness: 0, roughness: 1 });

const mesh = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], team = false) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot);
  m.userData.team = team;
  return m;
};
const box = (w, h, d, mat = HULL, pos, rot, team) => mesh(new THREE.BoxGeometry(w, h, d), mat, pos, rot, team);
const cyl = (rt, rb, h, mat = HULL, pos, rot, seg = 24, team) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, pos, rot, team);
const sphere = (r, mat = HULL, pos, seg = 24, team) => mesh(new THREE.SphereGeometry(r, seg, seg), mat, pos, [0, 0, 0], team);
const torus = (r, t, mat = HULL, pos, rot, team) => mesh(new THREE.TorusGeometry(r, t, 12, 48), mat, pos, rot, team);

const hexPrism = (r, h, mat = HULL, pos, rot, team) => mesh(new THREE.CylinderGeometry(r, r, h, 6), mat, pos, rot, team);
const group = (...children) => { const g = new THREE.Group(); for (const c of children) g.add(c); return g; };

/** A wedge hull pointing +X: length l, width w, height h. */
function wedge(l, w, h, mat = HULL) {
  const shape = new THREE.Shape();
  shape.moveTo(l / 2, 0); shape.lineTo(-l / 2, w / 2); shape.lineTo(-l / 2 + l * 0.12, 0); shape.lineTo(-l / 2, -w / 2); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: h * 0.15, bevelSize: w * 0.05, bevelSegments: 2 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -h / 2;
  return m;
}

const engineGlow = (r, pos) => cyl(r, r * 1.3, r * 0.6, ENGINE, pos, [0, 0, Math.PI / 2], 16, true);
const stripe = (l, w, pos, rot = [0, 0, 0]) => box(l, 0.06, w, TEAM, pos, rot, true);

export const MODELS = {
  // --- ships ------------------------------------------------------------------
  corvette() {
    const g = group(
      wedge(3.2, 1.2, 0.5),
      box(0.9, 0.35, 0.5, HULL_DARK, [-0.3, 0.3, 0]),
      box(1.4, 0.08, 2.0, HULL_DARK, [-0.9, 0, 0]),         // fins
      engineGlow(0.16, [-1.7, 0, 0.55]), engineGlow(0.16, [-1.7, 0, -0.55]),
      stripe(1.2, 0.12, [0.2, 0.29, 0.35]), stripe(1.2, 0.12, [0.2, 0.29, -0.35]),
    );
    return g;
  },
  frigate() {
    return group(
      wedge(5.2, 2.0, 0.8),
      box(1.8, 0.6, 1.0, HULL_DARK, [-0.6, 0.55, 0]),
      box(0.7, 0.4, 0.6, GLASS, [0.5, 0.75, 0]),
      cyl(0.32, 0.32, 3.0, HULL_DARK, [-1.0, -0.1, 1.15], [0, 0, Math.PI / 2]),
      cyl(0.32, 0.32, 3.0, HULL_DARK, [-1.0, -0.1, -1.15], [0, 0, Math.PI / 2]),
      engineGlow(0.26, [-2.6, -0.1, 1.15]), engineGlow(0.26, [-2.6, -0.1, -1.15]),
      stripe(2.2, 0.16, [0.3, 0.41, 0.55]), stripe(2.2, 0.16, [0.3, 0.41, -0.55]),
    );
  },
  cruiser() {
    return group(
      wedge(9.0, 2.6, 1.2),
      box(3.6, 0.9, 1.6, HULL_DARK, [-1.2, 0.9, 0]),
      box(1.2, 0.9, 1.0, HULL, [-2.2, 1.6, 0]),
      box(0.8, 0.5, 0.8, GLASS, [-1.6, 2.2, 0]),
      box(2.4, 0.4, 5.0, HULL_DARK, [-2.4, 0, 0]),          // wing bar
      cyl(0.55, 0.55, 4.4, HULL, [-2.6, 0, 2.3], [0, 0, Math.PI / 2]),
      cyl(0.55, 0.55, 4.4, HULL, [-2.6, 0, -2.3], [0, 0, Math.PI / 2]),
      engineGlow(0.45, [-4.9, 0, 2.3]), engineGlow(0.45, [-4.9, 0, -2.3]), engineGlow(0.35, [-4.6, 0.2, 0]),
      cyl(0.12, 0.12, 2.6, HULL_DARK, [2.6, 0.55, 0.5], [0, 0, Math.PI / 2]), cyl(0.12, 0.12, 2.6, HULL_DARK, [2.6, 0.55, -0.5], [0, 0, Math.PI / 2]), // spinal guns
      stripe(4.0, 0.2, [0.6, 0.61, 0.9]), stripe(4.0, 0.2, [0.6, 0.61, -0.9]), stripe(1.2, 0.2, [-1.2, 1.36, 0]),
    );
  },
  cargo() {
    const g = group(
      box(4.2, 1.4, 1.8, HULL_DARK, [-0.4, 0, 0]),
      box(1.2, 1.0, 1.4, HULL, [2.0, 0.1, 0]),
      box(0.5, 0.5, 0.9, GLASS, [2.5, 0.5, 0]),
      engineGlow(0.3, [-2.7, 0, 0.6]), engineGlow(0.3, [-2.7, 0, -0.6]),
    );
    for (let i = 0; i < 3; i++) {
      g.add(cyl(0.55, 0.55, 1.1, HULL_PALE, [-1.6 + i * 1.2, 0.95, 0.55], [Math.PI / 2, 0, 0]));
      g.add(cyl(0.55, 0.55, 1.1, HULL_PALE, [-1.6 + i * 1.2, 0.95, -0.55], [Math.PI / 2, 0, 0]));
      g.add(stripe(0.2, 1.0, [-1.6 + i * 1.2, 1.51, 0.55])); g.add(stripe(0.2, 1.0, [-1.6 + i * 1.2, 1.51, -0.55]));
    }
    return g;
  },
  // --- station and relay -----------------------------------------------------------
  station() {
    const g = group(
      hexPrism(2.2, 1.6, HULL_PALE, [0, 0, 0], [0, Math.PI / 6, 0]),
      hexPrism(1.2, 2.6, HULL, [0, 0, 0], [0, Math.PI / 6, 0]),
      torus(4.6, 0.32, HULL, [0, 0, 0], [Math.PI / 2, 0, 0]),
      torus(4.6, 0.09, TEAM, [0, 0.25, 0], [Math.PI / 2, 0, 0], true),
      cyl(0.18, 0.18, 4.0, GOLD, [0, 2.6, 0]),
      sphere(0.35, TEAM, [0, 4.7, 0], 12, true),
    );
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      g.add(box(4.6, 0.35, 0.6, HULL_DARK, [Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3], [0, -a, 0]));
      g.add(box(0.9, 1.2, 0.9, HULL, [Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6], [0, -a, 0]));
      g.add(box(0.1, 2.6, 1.6, PANEL, [Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6], [0, -a, 0]));
    }
    return g;
  },
  relay() {
    return group(
      box(1.6, 0.5, 1.6, HULL_DARK, [0, -0.5, 0]),
      cyl(0.14, 0.2, 2.4, HULL, [0, 0.7, 0]),
      mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3), HULL_PALE, [0, 1.4, 0], [Math.PI, 0, 0]),
      torus(1.3, 0.05, TEAM, [0, 1.75, 0], [Math.PI / 2, 0, 0], true),
      cyl(0.05, 0.05, 1.4, GOLD, [0, 2.2, 0]),
      sphere(0.15, TEAM, [0, 2.95, 0], 10, true),
      box(0.08, 1.4, 2.6, PANEL, [-1.2, 0.2, 0]), box(0.08, 1.4, 2.6, PANEL, [1.2, 0.2, 0]),
    );
  },
  // --- structures -----------------------------------------------------------------
  turret_light() {
    return group(
      cyl(1.1, 1.3, 0.5, HULL_DARK, [0, -0.3, 0], [0, 0, 0], 8),
      cyl(0.6, 0.7, 0.7, HULL, [0, 0.3, 0]),
      box(1.0, 0.6, 0.8, HULL_PALE, [0.2, 0.9, 0]),
      cyl(0.09, 0.09, 2.0, HULL_DARK, [1.4, 0.95, 0], [0, 0, Math.PI / 2]),
      stripe(0.6, 0.5, [0.1, 1.21, 0]),
    );
  },
  turret_heavy() {
    return group(
      hexPrism(1.6, 0.6, HULL_DARK, [0, -0.4, 0]),
      cyl(0.9, 1.0, 0.9, HULL, [0, 0.3, 0]),
      box(1.8, 1.0, 1.4, HULL_PALE, [0.2, 1.1, 0]),
      cyl(0.16, 0.16, 3.0, HULL_DARK, [1.9, 1.2, 0.4], [0, 0, Math.PI / 2]),
      cyl(0.16, 0.16, 3.0, HULL_DARK, [1.9, 1.2, -0.4], [0, 0, Math.PI / 2]),
      stripe(1.2, 0.9, [0.1, 1.61, 0]),
    );
  },
  launcher() {
    const g = group(box(2.6, 0.5, 2.0, HULL_DARK, [0, -0.3, 0]), box(2.2, 1.2, 1.6, HULL, [0, 0.4, 0], [0, 0, 0.35]));
    for (let i = 0; i < 6; i++) g.add(cyl(0.18, 0.18, 2.3, HULL_PALE, [0.5 + (i % 2) * 0.05, 0.55 + Math.floor(i / 3) * 0.45 - 0.2, -0.5 + (i % 3) * 0.5], [0, 0, Math.PI / 2 - 0.35], 12));
    g.add(stripe(1.4, 0.2, [-0.5, 1.05, 0.9], [0, 0, 0.35])); g.add(stripe(1.4, 0.2, [-0.5, 1.05, -0.9], [0, 0, 0.35]));
    return g;
  },
  bastion() {
    const g = group(
      hexPrism(2.6, 0.7, HULL_DARK, [0, -0.5, 0]),
      mesh(new THREE.SphereGeometry(1.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), HULL_PALE, [0, -0.15, 0]),
      torus(1.95, 0.08, TEAM, [0, 0.2, 0], [Math.PI / 2, 0, 0], true),
      sphere(0.4, GLASS, [0, 1.8, 0], 16),
    );
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3 + 0.3; g.add(cyl(0.18, 0.28, 2.2, GOLD, [Math.cos(a) * 2.4, 0.6, Math.sin(a) * 2.4])); g.add(sphere(0.22, TEAM, [Math.cos(a) * 2.4, 1.8, Math.sin(a) * 2.4], 10, true)); }
    return g;
  },
  extractor() {
    const g = group(
      cyl(1.2, 1.6, 0.4, HULL_DARK, [0, -0.6, 0], [0, 0, 0], 8),
      cyl(0.5, 0.7, 2.6, HULL, [0, 0.7, 0]),
      cyl(0.35, 0.05, 1.4, HULL_DARK, [0, -1.4, 0], [0, 0, 0], 12),   // drill below
      box(0.6, 0.6, 0.6, HULL_PALE, [0, 2.3, 0]),
    );
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; g.add(cyl(0.12, 0.12, 3.2, GOLD, [Math.cos(a) * 1.0, 0.6, Math.sin(a) * 1.0], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5])); g.add(cyl(0.55, 0.55, 1.1, HULL_PALE, [Math.cos(a) * 1.6, -0.2, Math.sin(a) * 1.6])); g.add(stripe(0.3, 0.3, [Math.cos(a) * 1.6, 0.36, Math.sin(a) * 1.6])); }
    return g;
  },
  warehouse() {
    const g = group(box(4.4, 0.4, 3.0, HULL_DARK, [0, -0.6, 0]));
    for (let i = 0; i < 3; i++) { g.add(cyl(0.7, 0.7, 2.2, HULL_PALE, [-1.4 + i * 1.4, 0.7, 0])); g.add(sphere(0.7, HULL, [-1.4 + i * 1.4, 1.8, 0], 16)); g.add(stripe(1.4, 0.2, [-1.4 + i * 1.4, 0.75, 0.71], [Math.PI / 2, 0, 0])); }
    g.add(box(1.2, 0.8, 1.0, HULL, [0, 0, 1.6]));
    return g;
  },
  shipyard() {
    const g = group(
      box(7.0, 0.5, 0.6, HULL_DARK, [0, 0, 1.8]), box(7.0, 0.5, 0.6, HULL_DARK, [0, 0, -1.8]),
      box(0.6, 0.5, 4.2, HULL_DARK, [-3.2, 0, 0]),
      box(1.4, 1.6, 1.2, HULL, [-3.0, 0.6, 2.4]),
      box(0.5, 0.4, 0.8, GLASS, [-2.8, 1.5, 2.4]),
    );
    for (let i = 0; i < 4; i++) { g.add(box(0.25, 1.8, 0.25, HULL, [-2.4 + i * 1.6, 0.9, 1.8])); g.add(box(0.25, 1.8, 0.25, HULL, [-2.4 + i * 1.6, 0.9, -1.8])); g.add(box(0.2, 0.2, 3.9, GOLD, [-2.4 + i * 1.6, 1.8, 0])); g.add(stripe(0.3, 0.3, [-2.4 + i * 1.6, 1.91, 0])); }
    g.add(wedge(3.6, 1.4, 0.5, HULL_PALE)); // hull under construction
    return g;
  },
  antenna() {
    const g = group(box(1.4, 0.4, 1.4, HULL_DARK, [0, -0.6, 0]), cyl(0.1, 0.16, 4.6, HULL, [0, 1.7, 0]), sphere(0.2, TEAM, [0, 4.1, 0], 10, true));
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; const y = 0.6 + i * 1.1; g.add(mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), HULL_PALE, [Math.cos(a) * 0.8, y, Math.sin(a) * 0.8], [Math.PI / 2 + 0.3, a + Math.PI / 2, 0])); }
    return g;
  },
  amplifier() {
    const g = group(box(2.0, 0.4, 2.0, HULL_DARK, [0, -0.6, 0]), cyl(0.2, 0.2, 3.4, GOLD, [0, 1.0, 0]));
    for (let i = 0; i < 3; i++) { g.add(torus(1.1 - i * 0.2, 0.09, HULL_PALE, [0, 0.4 + i * 1.0, 0], [Math.PI / 2, 0, 0])); g.add(torus(1.1 - i * 0.2, 0.03, TEAM, [0, 0.5 + i * 1.0, 0], [Math.PI / 2, 0, 0], true)); }
    g.add(sphere(0.3, GLASS, [0, 2.9, 0], 12));
    return g;
  },
  tradepost() {
    const g = group(
      cyl(2.2, 2.4, 0.5, HULL_DARK, [0, -0.5, 0], [0, 0, 0], 8),
      sphere(1.3, HULL_PALE, [0, 0.3, 0], 24),
      sphere(0.7, HULL_PALE, [1.6, 0, 0.9], 16), sphere(0.7, HULL_PALE, [-1.4, 0, -1.2], 16),
      torus(1.32, 0.05, TEAM, [0, 0.4, 0], [Math.PI / 2, 0, 0], true),
    );
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; g.add(box(2.2, 0.2, 0.4, GOLD, [Math.cos(a) * 2.6, -0.1, Math.sin(a) * 2.6], [0, -a, 0])); g.add(box(0.4, 0.5, 0.8, HULL, [Math.cos(a) * 3.6, -0.1, Math.sin(a) * 3.6], [0, -a, 0])); }
    return g;
  },
};
