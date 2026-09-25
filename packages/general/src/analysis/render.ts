// The analysis, rendered for the model: a compact block of facts in the player's language, and the set
// of numbers the General is allowed to cite. Post-processing checks every number in the answer against
// that set: the model narrates the engine's figures, it does not make its own.
import type { Analysis } from './analyze.js';
import { safeName } from '../security.js';

const RES: Record<string, { fr: string; en: string }> = { metal: { fr: 'Métal', en: 'Metal' }, energy: { fr: 'Énergie', en: 'Energy' }, food: { fr: 'Vivres', en: 'Food' }, crystal: { fr: 'Cristal', en: 'Crystal' }, rium: { fr: 'Rium', en: 'Rium' } };

export function renderAnalysis(a: Analysis, lang: 'fr' | 'en'): string {
  const L = lang;
  const n = (x: { name: string }): string => safeName(x.name);
  const lines: string[] = [];
  const c = a.colony;
  if (L === 'fr') {
    lines.push(`Colonie ${n(c)} (${c.faction}), capitale ${n(c.capital)} : ${c.connected} système(s) relié(s) sur ${c.owned}, score ${c.score}, ${c.credits} Crédits, ${c.influence} Influence. Tirage n°${a.drawIndex}, prochain dans ${a.nextDrawMin} min.`);
    lines.push(`Stocks : ${Object.entries(a.stock).map(([r, v]) => `${RES[r]!.fr} ${Math.round(v)}`).join(', ')}.`);
    lines.push(`Énergie : ${a.energy.stock} en stock, +${a.energy.incomePerDraw} produits et −${a.energy.upkeepPerDraw} d'entretien par Tirage (net ${a.energy.netPerDraw >= 0 ? '+' : ''}${a.energy.netPerDraw}).${a.energy.drawsUntilDark !== null ? ` À ce rythme les relais s'éteignent dans ${a.energy.drawsUntilDark} Tirage(s), en commençant par ${a.energy.firstToDarken.map((r) => `${n(r.a)}–${n(r.b)}`).join(', ') || 'aucun'}.` : ''}`);
    lines.push(a.bridges.length ? `Ponts critiques (un seul relais, perte si coupé) : ${a.bridges.slice(0, 4).map((b) => `${n(b.a)}–${n(b.b)} → ${b.lostSystems} système(s) perdu(s)${b.guarded ? ', tourelles aux deux bouts' : ', sans tourelle'}`).join(' ; ')}.` : 'Ponts critiques : aucun, le Réseau est doublé.');
    if (a.articulations.length) lines.push(`Stations dont la chute coupe le Réseau : ${a.articulations.slice(0, 3).map((x) => `${n(x.system)} (${x.lostSystems} système(s))`).join(', ')}.`);
    const t = a.threats;
    lines.push(t.inbound.length ? `MENACES : ${t.inbound.slice(0, 3).map((i) => `${i.ships} vaisseau(x) de ${n(i.from)}${i.npc ? ' (PNJ)' : ''} vers ${n(i.target)}, arrivée dans ${i.etaMin} min`).join(' ; ')}.` : 'Menaces : aucune flotte hostile en approche.');
    if (t.engaged.length) lines.push(`Combat en cours à : ${t.engaged.map(n).join(', ')}.`);
    if (t.blockaded.length) lines.push(`Blocus : ${t.blockaded.map((b) => `${n(b.system)} par ${n(b.by)} depuis ${b.sinceMin} min, capture dans ${b.captureInMin} min`).join(' ; ')}.`);
    lines.push(`Protections : ${t.protections.shielded ? `bouclier de débutant encore ${t.protections.shieldHoursLeft} h` : 'plus de bouclier'} ; Garde de nuit ${t.protections.watching ? 'ACTIVE' : 'inactive'} (${t.protections.watchHours} h à partir de ${t.protections.watchStartHour} h).`);
    const e = a.economy;
    lines.push(`Économie : ${e.lines.map((l) => `${RES[l.resource]!.fr} ${l.surplus >= 0 ? 'surplus' : 'déficit'} ${Math.abs(l.surplus)} (réserve ${l.reserve}, +${l.incomePerDraw}/Tirage${l.prices.length ? `, prix ${l.prices.map((p) => `${p.price} en ${p.region}`).join(' / ')}` : ''})`).join(' ; ')}.`);
    if (e.arbitrage.length) lines.push(`Arbitrage : ${e.arbitrage.slice(0, 2).map((x) => `${RES[x.resource]!.fr} à ${x.buyPrice} en ${x.buyRegion} contre ${x.sellPrice} en ${x.sellRegion} (+${x.spreadPct} %)`).join(' ; ')}.`);
    if (e.warehouses.length) lines.push(`Entrepôts pleins : ${e.warehouses.map((x) => `${n(x.system)} ${x.fillPct} % (${RES[x.resource]!.fr})`).join(', ')}${e.overflowLastDraw ? ` ; ${e.overflowLastDraw} ressources perdues au dernier Tirage` : ''}.`);
    const b = a.beacons.slice(0, 3);
    if (b.length) lines.push(`Phares : ${b.map((x) => `${x.beaconName} à ${x.sectors} secteur(s), ${x.lit ? `rallumé par ${n(x.litBy!)}` : x.owned ? `à nous, ${x.crystalHave}/${x.crystalNeeded} Cristal sur place` : x.holder ? `tenu par ${n(x.holder)}` : 'libre'}${x.link ? `, reliable depuis ${n(x.link.from)} pour ${x.link.metal} Métal` : ''}`).join(' ; ')}.`);
    lines.push(`OPTIONS (choisis ou recommande parmi celles-ci, rien d'autre) :`);
    a.options.forEach((o, i) => lines.push(`${i + 1}. [${o.id}] ${o.label.fr} — gain : ${o.gain.fr} — risque ${o.risk === 'low' ? 'faible' : o.risk === 'mid' ? 'moyen' : 'élevé'}${o.command ? '' : ' — pas exécutable en l\'état'}.`));
    if (a.crisis) lines.push('CRISE EN COURS : pas d\'humour, des faits et une recommandation.');
    return lines.join('\n');
  }
  lines.push(`Colony ${n(c)} (${c.faction}), capital ${n(c.capital)}: ${c.connected} connected system(s) of ${c.owned}, score ${c.score}, ${c.credits} Credits, ${c.influence} Influence. Draw #${a.drawIndex}, next in ${a.nextDrawMin} min.`);
  lines.push(`Stocks: ${Object.entries(a.stock).map(([r, v]) => `${RES[r]!.en} ${Math.round(v)}`).join(', ')}.`);
  lines.push(`Energy: ${a.energy.stock} in stock, +${a.energy.incomePerDraw} produced and −${a.energy.upkeepPerDraw} upkeep per Draw (net ${a.energy.netPerDraw >= 0 ? '+' : ''}${a.energy.netPerDraw}).${a.energy.drawsUntilDark !== null ? ` At this pace the relays go dark in ${a.energy.drawsUntilDark} Draw(s), starting with ${a.energy.firstToDarken.map((r) => `${n(r.a)}–${n(r.b)}`).join(', ') || 'none'}.` : ''}`);
  lines.push(a.bridges.length ? `Critical bridges (single relay, loss if cut): ${a.bridges.slice(0, 4).map((b) => `${n(b.a)}–${n(b.b)} → ${b.lostSystems} system(s) lost${b.guarded ? ', turrets at both ends' : ', no turret'}`).join('; ')}.` : 'Critical bridges: none, the Network is doubled.');
  if (a.articulations.length) lines.push(`Stations whose fall cuts the Network: ${a.articulations.slice(0, 3).map((x) => `${n(x.system)} (${x.lostSystems} system(s))`).join(', ')}.`);
  const t = a.threats;
  lines.push(t.inbound.length ? `THREATS: ${t.inbound.slice(0, 3).map((i) => `${i.ships} ship(s) from ${n(i.from)}${i.npc ? ' (NPC)' : ''} heading for ${n(i.target)}, arrival in ${i.etaMin} min`).join('; ')}.` : 'Threats: no hostile fleet inbound.');
  if (t.engaged.length) lines.push(`Fighting at: ${t.engaged.map(n).join(', ')}.`);
  if (t.blockaded.length) lines.push(`Blockades: ${t.blockaded.map((b) => `${n(b.system)} by ${n(b.by)} for ${b.sinceMin} min, capture in ${b.captureInMin} min`).join('; ')}.`);
  lines.push(`Protections: ${t.protections.shielded ? `newcomer shield for ${t.protections.shieldHoursLeft} h more` : 'no shield any more'}; Night Watch ${t.protections.watching ? 'ACTIVE' : 'inactive'} (${t.protections.watchHours} h from ${t.protections.watchStartHour}:00).`);
  const e = a.economy;
  lines.push(`Economy: ${e.lines.map((l) => `${RES[l.resource]!.en} ${l.surplus >= 0 ? 'surplus' : 'deficit'} ${Math.abs(l.surplus)} (reserve ${l.reserve}, +${l.incomePerDraw}/Draw${l.prices.length ? `, price ${l.prices.map((p) => `${p.price} in ${p.region}`).join(' / ')}` : ''})`).join('; ')}.`);
  if (e.arbitrage.length) lines.push(`Arbitrage: ${e.arbitrage.slice(0, 2).map((x) => `${RES[x.resource]!.en} at ${x.buyPrice} in ${x.buyRegion} against ${x.sellPrice} in ${x.sellRegion} (+${x.spreadPct} %)`).join('; ')}.`);
  if (e.warehouses.length) lines.push(`Full warehouses: ${e.warehouses.map((x) => `${n(x.system)} ${x.fillPct} % (${RES[x.resource]!.en})`).join(', ')}${e.overflowLastDraw ? `; ${e.overflowLastDraw} resources lost at the last Draw` : ''}.`);
  const b = a.beacons.slice(0, 3);
  if (b.length) lines.push(`Beacons: ${b.map((x) => `${x.beaconName} ${x.sectors} sector(s) away, ${x.lit ? `lit by ${n(x.litBy!)}` : x.owned ? `ours, ${x.crystalHave}/${x.crystalNeeded} Crystal on site` : x.holder ? `held by ${n(x.holder)}` : 'free'}${x.link ? `, linkable from ${n(x.link.from)} for ${x.link.metal} Metal` : ''}`).join('; ')}.`);
  lines.push('OPTIONS (choose or recommend among these, nothing else):');
  a.options.forEach((o, i) => lines.push(`${i + 1}. [${o.id}] ${o.label.en} — gain: ${o.gain.en} — ${o.risk} risk${o.command ? '' : ' — not executable as is'}.`));
  if (a.crisis) lines.push('CRISIS UNDER WAY: no humour, facts and one recommendation.');
  return lines.join('\n');
}

/** Numbers that belong to the rules themselves and may always be cited (hours, percentages, prices of reference…). */
export const RULE_NUMBERS: readonly number[] = [0, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 20, 24, 25, 40, 50, 60, 100, 200, 260, 2000, 0.002, 0.5];

const NUM_RE = /(?<![\w.,#])[-−+]?\d{1,3}(?:[ \u202F\u00A0]\d{3})*(?:[.,]\d+)?(?![\w#])/g;

/** Every number appearing in a text, as JS numbers (French thousands spaces and decimal commas understood). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const raw = m[0].replace(/[ \u202F\u00A0]/g, '').replace(',', '.').replace('−', '-');
    const v = Number(raw);
    if (Number.isFinite(v)) out.push(Math.abs(v));
  }
  return out;
}

/** The numbers the General may cite: everything in the rendered analysis (both languages) plus the rules' constants. */
export function allowedNumbers(a: Analysis, extraText = ''): Set<number> {
  const set = new Set<number>(RULE_NUMBERS);
  for (const v of numbersIn(renderAnalysis(a, 'fr'))) set.add(v);
  for (const v of numbersIn(renderAnalysis(a, 'en'))) set.add(v);
  for (const v of numbersIn(extraText)) set.add(v);
  // Rounded forms of the same facts are fine ("1 200" for 1187 is not, "1187 → 1190" is).
  for (const v of [...set]) { set.add(Math.round(v)); if (v >= 100) set.add(Math.round(v / 10) * 10); }
  return set;
}

export interface NumberCheck { ok: boolean; unknown: number[]; /** The text with the sentences carrying unknown numbers removed. */ stripped: string }

/** Does the answer cite only allowed numbers? Ordinals like "1." and small counts up to 12 always pass. */
export function verifyNumbers(text: string, allowed: Set<number>): NumberCheck {
  const isOk = (v: number): boolean => {
    if (v <= 12 && Number.isInteger(v)) return true;
    for (const a of allowed) if (Math.abs(v - a) <= Math.max(0.05, a * 0.01)) return true;
    return false;
  };
  const unknown = numbersIn(text).filter((v) => !isOk(v));
  if (!unknown.length) return { ok: true, unknown, stripped: text };
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const kept = sentences.filter((s) => numbersIn(s).every(isOk));
  return { ok: false, unknown, stripped: kept.join(' ').trim() };
}
