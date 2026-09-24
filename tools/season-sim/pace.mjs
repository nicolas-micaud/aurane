// Player-experience curve: one "human-like" colony (driven by the General's rule engine) among 30 NPCs.
// Prints when the player first does or suffers each thing, an hourly table, and the quiet hours.
// Usage (from the repo root, after `npm run build`): node tools/season-sim/pace.mjs [persona] [days] [radius]
/* global process, console */
import { FACTIONS, PERSONAS } from '../../packages/protocol/dist/index.js';
import { apply, createWorld, decide, spawnColony, tick, productiveSystems, colonyScore } from '../../packages/sim/dist/index.js';
const persona = process.argv[2] ?? 'oriel'; const days = Number(process.argv[3] ?? 7); const radius = Number(process.argv[4] ?? 12);
const w = createWorld('beta-1', { radius, seasonDays: days });
for (let i = 0; i < 30; i++) { try { spawnColony(w, { name: `npc-${i}`, faction: FACTIONS[i % 4], persona: PERSONAS[(i * 7 + Math.floor(i / 4)) % 4], npc: true }); } catch { break; } }
const me = spawnColony(w, { name: 'Nick', faction: 'guild', persona, npc: false });
const step = 1800; let ti = 0; const firsts = {}; const hourly = [];
const mark = (k) => { if (!(k in firsts)) firsts[k] = +(w.time / 3600).toFixed(1); };
let lastEvents = 0;
while (w.time < days * 86400 && !w.ended) {
  for (const c of Object.values(w.colonies)) { const d = decide(w, c, ti); for (const cmd of d.commands) { const r = apply(w, c.id, cmd); if (c.id === me.id && r.ok) { if (cmd.type === 'build_relay') mark('relay'); if (cmd.type === 'train' && cmd.unit !== 'cargo') mark('warship'); if (cmd.type === 'build') mark('building:' + cmd.building); if (cmd.type === 'market_order') mark('market_order'); if (cmd.type === 'fleet_order' && (cmd.order === 'raid' || cmd.order === 'blockade')) mark('attack_sent'); if (cmd.type === 'treaty') mark('treaty'); if (cmd.type === 'barter_propose' || cmd.type === 'barter') mark('barter'); } } }
  tick(w, step, 300); ti++;
  const evs = w.events.slice(lastEvents); lastEvents = w.events.length;
  for (const e of evs) {
    const mine = e.actors.includes(me.id);
    if (mine && e.kind === 'barter.done') mark('trade_done');
    if (mine && (e.kind === 'battle' || e.kind === 'battle.start')) mark(e.actors[0] === me.id ? 'battle_as_attacker' : 'battle_as_defender');
    if (mine && e.kind === 'relay.cut' && e.actors[1] === me.id) mark('my_relay_cut');
    if (mine && e.kind === 'blockade.start' && e.actors[1] === me.id) mark('besieged');
    if (mine && e.kind === 'system.captured') mark(e.actors[0] === me.id ? 'captured_a_system' : 'lost_a_system');
    if (mine && e.kind === 'alliance.joined') mark('alliance');
    if (mine && e.kind === 'convoy.lost') mark('convoy_lost');
  }
  if (ti % 2 === 0) {
    const cap = w.systems[me.capital];
    const conn = productiveSystems(w, me).length;
    if (conn >= 3) mark('3_systems'); if (conn >= 6) mark('6_systems'); if (conn >= 10) mark('10_systems');
    const myEv = evs.filter((e) => e.actors.includes(me.id) && e.kind !== 'draw').length;
    hourly.push({ h: ti / 2, conn, metal: Math.round(cap.stock.metal), energy: Math.round(cap.stock.energy), rium: Math.round(cap.stock.rium), credits: Math.round(me.credits), score: +colonyScore(w, me).toFixed(1), ev: myEv, fleets: Object.values(w.fleets).filter((f) => f.owner === me.id).length });
  }
}
console.log('persona', persona, 'firsts (hours):', JSON.stringify(firsts));
const pick = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168].filter((h) => hourly[h - 1]);
console.log('h\tconn\tmetal\tenergy\trium\tcredits\tscore\tev/h\tfleets');
for (const h of pick) { const r = hourly[h - 1]; console.log([r.h, r.conn, r.metal, r.energy, r.rium, r.credits, r.score, r.ev, r.fleets].join('\t')); }
const quiet = hourly.filter((r) => r.ev === 0).length;
console.log('hours with no event touching the player:', quiet, '/', hourly.length);
const all = w.events.filter((e) => e.actors.includes(me.id)); const kinds = {}; for (const e of all) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; console.log('event kinds for player:', JSON.stringify(kinds));
const ranks = Object.values(w.colonies).map((c) => ({ n: c.name, s: colonyScore(w, c) })).sort((a, b) => b.s - a.s); console.log('rank of player:', ranks.findIndex((r) => r.n === 'Nick') + 1, '/', ranks.length, 'top', ranks.slice(0, 3).map((r) => `${r.n}:${r.s.toFixed(1)}`).join(' '));
