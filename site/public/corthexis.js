/* global document, window, matchMedia, performance, requestAnimationFrame, IntersectionObserver, addEventListener, setTimeout, clearTimeout */
// Corthexis on the landing: a Colony's memory growing over two seasons, drawn on a canvas.
// No dependency. The story is scripted (not live data); labels come from the page (#cx-data, FR/EN).
(() => {
  const cv = document.getElementById('cx-canvas');
  const dataEl = document.getElementById('cx-data');
  if (!cv || !dataEl) return;
  const L = JSON.parse(dataEl.textContent);
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COL = { general: '#7dd3fc', decision: '#7dd3fc', ally: '#e8c872', betrayal: '#ff5d6c', battle: '#e07a3f', episode: '#9b7bff', refusal: '#ff9f43' };
  // The script: [time s, action]. Nodes attach to a parent; 'recall' lights a path; 'silence' dims the world.
  const STORY = [
    [0.4, 'node', 'd1', 'decision', 'g'], [2.0, 'node', 'e1', 'episode', 'd1'], [3.4, 'node', 'a1', 'ally', 'g'],
    [4.8, 'node', 'x1', 'battle', 'g'], [5.4, 'link', 'x1', 'a1'], [6.8, 'node', 'b1', 'betrayal', 'x1'],
    [8.2, 'refuse', 'r1', 'refusal', 'g'], [9.8, 'node', 'd2', 'decision', 'x1'], [11.2, 'node', 'e2', 'episode', 'a1'],
    [12.6, 'recall', ['d2', 'x1', 'b1']], [15.2, 'silence'], [19.0, 'season'], [19.6, 'node', 's1', 'betrayal', 'b1'],
    [21.0, 'recall', ['s1', 'b1', 'a1']], [23.4, 'node', 'd3', 'decision', 'g'], [24.6, 'node', 'd4', 'decision', 'd3'],
    [30.0, 'reset'],
  ];
  let W = 0, H = 0, dpr = 1, nodes, links, byId, logLines, season, silence, t0, stepI, particles, stars, visible = true, running = false, last = 0;

  function size() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round((W * H) / 2600) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.2, a: Math.random() * 0.6 + 0.2, tw: Math.random() * 6.28 }));
  }
  function reset() {
    nodes = [{ id: 'g', type: 'general', x: W / 2, y: H / 2, vx: 0, vy: 0, born: 0, fixed: true, s0: false }];
    byId = { g: nodes[0] }; links = []; logLines = []; season = 0; silence = 0; stepI = 0; particles = [];
    t0 = performance.now() / 1000;
  }
  const label = (id) => (id === 'g' ? L.general : L.nodes[id]);
  const now = () => performance.now() / 1000 - t0;
  const clock = (s) => { const m = Math.floor(s / 60), x = Math.floor(s % 60); return `T+${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
  function log(text, cls) { logLines.push({ text, cls, at: now() }); if (logLines.length > 5) logLines.shift(); }
  function addNode(id, type, parent) {
    const p = byId[parent] || nodes[0], a = Math.random() * Math.PI * 2;
    const n = { id, type, x: p.x + Math.cos(a) * 40, y: p.y + Math.sin(a) * 40, vx: 0, vy: 0, born: now(), s0: season === 0, flash: 1 };
    nodes.push(n); byId[id] = n; addLink(parent, id);
    log(`${clock(now() * 37)}  ${L.log.note} ${L.types[type]} « ${label(id)} »`, type);
  }
  function addLink(a, b) {
    if (!byId[a] || !byId[b]) return;
    links.push({ a: byId[a], b: byId[b], born: now() });
    if (a !== 'g') log(`${L.log.link} ${L.types[byId[a].type]} → ${L.types[byId[b].type]}`, 'link');
  }
  function step() {
    while (stepI < STORY.length && STORY[stepI][0] <= now()) {
      const [, act, ...args] = STORY[stepI++];
      if (act === 'node') addNode(...args);
      else if (act === 'link') addLink(...args);
      else if (act === 'refuse') { addNode(...args); log(`✕ ${L.log.refuse}`, 'refusal'); }
      else if (act === 'recall') {
        log(`${L.log.recall} → ${L.log.recallOut}`, 'recall');
        const path = args[0].map((id) => byId[id]).filter(Boolean);
        path.forEach((n, i) => { n.recall = now() + i * 0.25; });
        path.forEach((n) => { for (let k = 0; k < 6; k++) particles.push({ from: n, to: nodes[0], p: -k * 0.12, speed: 0.9 + Math.random() * 0.4, c: '#ffffff' }); });
      } else if (act === 'silence') { silence = now(); log(L.log.silence, 'silence'); }
      else if (act === 'season') { season = 1; log(L.log.season, 'season'); }
      else if (act === 'reset') reset();
    }
  }
  function physics(dt) {
    const k = Math.min(dt, 0.05) * 60;
    for (const n of nodes) {
      if (n.fixed) { n.x += (W / 2 - n.x) * 0.1; n.y += (H / 2 - n.y) * 0.1; continue; }
      for (const m of nodes) {
        if (m === n) continue;
        let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = 1400 / d2; n.vx += dx * f * 0.02 * k; n.vy += dy * f * 0.02 * k;
      }
      n.vx += (W / 2 - n.x) * 0.0009 * k; n.vy += (H / 2 - n.y) * 0.0014 * k;
    }
    const rest = Math.min(W, H) * 0.2;
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1, f = (d - rest) * 0.004 * k;
      if (!l.a.fixed) { l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f; }
      if (!l.b.fixed) { l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f; }
    }
    for (const n of nodes) { if (n.fixed) continue; n.vx *= 0.86; n.vy *= 0.86; n.x += n.vx; n.y += n.vy; n.x = Math.max(60, Math.min(W - 60, n.x)); n.y = Math.max(W < 560 ? 56 : 40, Math.min(H - 86, n.y)); }
  }
  function rgba(hex, a) { const v = parseInt(hex.slice(1), 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    // Silence: the world's stars fade for a few seconds; the memory stays lit.
    const sil = silence ? Math.max(0, 1 - Math.abs(t - silence - 1.9) / 1.9) : 0;
    for (const s of stars) { ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * 1.3 + s.tw)) * (1 - sil * 0.9); ctx.fillStyle = '#cfe8ff'; ctx.fillRect(s.x, s.y, s.r, s.r); }
    ctx.globalAlpha = 1;
    // hex grid, faint, the season's board
    ctx.strokeStyle = `rgba(125,211,252,${0.05 * (1 - sil)})`; ctx.lineWidth = 1;
    const R = 34, hh = R * Math.sqrt(3);
    for (let y = -hh, row = 0; y < H + hh; y += hh / 2, row++) for (let x = (row % 2) * R * 1.5; x < W + R; x += R * 3) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; ctx.lineTo(x + R * Math.cos(a), y + R * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
    // links
    for (const l of links) {
      const age = Math.min(1, (t - l.born) / 0.8), hot = l.b.type === 'betrayal' || l.a.type === 'betrayal';
      const g = ctx.createLinearGradient(l.a.x, l.a.y, l.b.x, l.b.y);
      g.addColorStop(0, rgba(COL[l.a.type], 0.55 * age)); g.addColorStop(1, rgba(COL[l.b.type], 0.55 * age));
      ctx.strokeStyle = g; ctx.lineWidth = hot ? 1.6 : 1.1;
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.a.x + (l.b.x - l.a.x) * age, l.a.y + (l.b.y - l.a.y) * age); ctx.stroke();
      if (Math.random() < 0.012 && age >= 1) particles.push({ from: l.a, to: l.b, p: 0, speed: 0.5 + Math.random() * 0.5, c: COL[l.b.type] });
    }
    // particles (synaptic pulses)
    particles = particles.filter((q) => q.p < 1);
    for (const q of particles) {
      q.p += 0.016 * q.speed; if (q.p < 0) continue;
      const x = q.from.x + (q.to.x - q.from.x) * q.p, y = q.from.y + (q.to.y - q.from.y) * q.p;
      ctx.fillStyle = q.c; ctx.shadowColor = q.c; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.29); ctx.fill(); ctx.shadowBlur = 0;
    }
    // nodes
    ctx.textBaseline = 'middle';
    for (const n of nodes) {
      const c = COL[n.type], age = Math.min(1, (t - n.born) / 0.6), r = (n.type === 'general' ? 11 : 6) * (0.4 + 0.6 * age);
      const rec = n.recall ? Math.max(0, 1 - Math.abs(t - n.recall - 0.8) / 0.8) : 0;
      n.flash = Math.max(0, (n.flash || 0) - 0.015);
      const past = season === 1 && n.s0 ? 0.82 : 1;
      const glow = 10 + r * 2 + rec * 34 + n.flash * 30 + (n.type === 'general' ? 10 + 6 * Math.sin(t * 2) : 0) + sil * 20;
      ctx.shadowColor = c; ctx.shadowBlur = glow;
      ctx.fillStyle = rgba(c, past); ctx.beginPath(); ctx.arc(n.x, n.y, r + rec * 3, 0, 6.29); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(c, 0.35 + rec * 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 + 3 * Math.sin(t * 2 + n.born), 0, 6.29); ctx.stroke();
      if (W > 420 || n.type === 'general' || rec > 0 || n.flash > 0.25) {
        ctx.font = `${n.type === 'general' ? 600 : 500} ${n.type === 'general' ? 13 : 11.5}px Inter,system-ui,sans-serif`;
        ctx.fillStyle = `rgba(215,223,238,${(0.55 + 0.45 * Math.max(rec, n.flash)) * age * past})`;
        const txt = label(n.id), tw = ctx.measureText(txt).width, left = n.x > W - tw - 30;
        ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(txt, n.x + (left ? -(r + 9) : r + 9), n.y);
        ctx.font = '9.5px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.fillStyle = rgba(c, 0.7 * age * past);
        if (n.type !== 'general') ctx.fillText(L.types[n.type].toUpperCase(), n.x + (left ? -(r + 9) : r + 9), n.y + 13);
      }
    }
    // HUD
    ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.fillStyle = 'rgba(125,211,252,.9)';
    ctx.fillText(L.hud, 14, 18);
    const narrow = W < 560;
    ctx.textAlign = narrow ? 'left' : 'right'; ctx.fillStyle = 'rgba(159,176,208,.9)';
    ctx.fillText(`${nodes.length - 1} ${L.notes} · ${links.length} ${L.links} · ${season + 1} ${L.seasons}`, narrow ? 14 : W - 14, narrow ? 34 : 18);
    ctx.textAlign = 'left'; ctx.font = `${narrow ? 9 : 10.5}px ui-monospace,SFMono-Regular,Menlo,monospace`;
    const lh = 14, y0 = H - 12 - (logLines.length - 1) * lh;
    logLines.forEach((ln, i) => {
      const a = Math.min(1, (t - ln.at) / 0.3) * (0.45 + 0.55 * (i + 1) / logLines.length);
      const c = ln.cls === 'silence' || ln.cls === 'season' ? '#ffffff' : ln.cls === 'recall' ? '#7dd3fc' : COL[ln.cls] || '#9fb0d0';
      let shown = ln.text.slice(0, Math.floor((t - ln.at) * 90));
      while (shown.length > 4 && ctx.measureText(shown).width > W - 28) shown = shown.slice(0, -2) + '…';
      ctx.fillStyle = rgba(c.length === 7 ? c : '#9fb0d0', a); ctx.fillText(shown, 14, y0 + i * lh);
    });
    if (sil > 0) { ctx.fillStyle = `rgba(5,7,15,${sil * 0.35})`; ctx.fillRect(0, 0, W, H); }
  }
  function frame(ms) {
    const t = ms / 1000 - t0, dt = last ? ms / 1000 - last : 0.016; last = ms / 1000;
    step(); physics(dt); draw(t);
    if (visible && running) requestAnimationFrame(frame); else running = false;
  }
  function start() { if (!running && visible) { running = true; last = 0; requestAnimationFrame(frame); } }
  size(); reset();
  if (reduce) { // one still frame: the whole story at once
    t0 -= 26; for (let i = 0; i < 400; i++) { step(); physics(0.016); } nodes.forEach((n) => { n.born -= 10; n.flash = 0; }); links.forEach((l) => { l.born -= 10; }); logLines.forEach((l) => { l.at -= 10; }); draw(now()); return;
  }
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; start(); }, { threshold: 0.05 }).observe(cv);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const ox = W, oy = H; size(); nodes.forEach((n) => { n.x *= W / ox; n.y *= H / oy; }); }, 150); });
})();
