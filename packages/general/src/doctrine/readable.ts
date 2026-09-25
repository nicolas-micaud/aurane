// The compiled doctrine, readable by the player before it is active: one line per rule, names instead
// of ids, in the player's language.
import { RESOURCES, type Policy } from '@aurane/protocol';
import type { DoctrineContext } from '../doctrine.js';

const RES: Record<string, { fr: string; en: string }> = { metal: { fr: 'Métal', en: 'Metal' }, energy: { fr: 'Énergie', en: 'Energy' }, food: { fr: 'Vivres', en: 'Food' }, crystal: { fr: 'Cristal', en: 'Crystal' }, rium: { fr: 'Rium', en: 'Rium' } };

export function readablePolicy(p: Policy, ctx: DoctrineContext): string[] {
  const L = ctx.lang;
  const pct = (x: number): string => `${Math.round(x * 100)} %`;
  const sysName = (id: string): string => (id === '__capital__' ? (L === 'fr' ? 'la capitale' : 'the capital') : ctx.systems[id] ?? id);
  const colName = (id: string): string => ctx.colonies[id] ?? ctx.alliances[id] ?? id;
  const out: string[] = [];
  if (L === 'fr') {
    out.push(`Expansion : ${pct(p.expansion)} ${p.expansion === 0 ? '(aucun nouveau relais)' : p.expansion >= 0.9 ? '(dès que possible)' : ''}`.trim());
    out.push(`Agressivité : ${pct(p.aggression)} ${p.aggression === 0 ? '(jamais d\'attaque sans ordre)' : p.aggression >= 0.7 ? '(raids libres sur les voisins faibles)' : '(raids mesurés)'}`);
    if (p.defendFirst.length) out.push(`Défendre d'abord : ${p.defendFirst.map(sysName).join(', ')}`);
    if (p.neverAttack.length) out.push(`Ne jamais attaquer : ${p.neverAttack.map(colName).join(', ')}`);
    if (p.trustedTraders.length) out.push(`Partenaires de confiance : ${p.trustedTraders.map(colName).join(', ')}`);
    for (const r of RESOURCES) if (p.reserves[r] !== undefined) out.push(`Réserve de ${RES[r]!.fr} : ${p.reserves[r]}`);
    for (const r of RESOURCES) if (p.sellAbove[r] !== undefined) out.push(`Vendre le surplus de ${RES[r]!.fr} à partir de ${p.sellAbove[r]} Crédits`);
    for (const r of RESOURCES) if (p.buyBelow[r] !== undefined) out.push(`Acheter du ${RES[r]!.fr} jusqu'à ${p.buyBelow[r]} Crédits`);
    if (p.fuel !== 'auto') out.push(`Carburant : ${p.fuel === 'refinery' ? 'raffineries sur les géantes gazeuses' : 'synthétiseurs à la maison'}`);
    out.push(`Tourelles automatiques : ${p.autoTurrets} par système attaqué`);
    out.push(`Repli des flottes sous ${pct(p.retreatBelow)} de coques`);
    out.push(`Escorte des convois au-dessus de ${p.escortAbove} Crédits de cargaison`);
    out.push(`Cible prioritaire : ${{ ships: 'vaisseaux', turrets: 'tourelles', station: 'station', economy: 'économie' }[p.targetPriority]}`);
    if (p.notes) out.push(`En une phrase : « ${p.notes.slice(0, 200)} »`);
    return out;
  }
  out.push(`Expansion: ${pct(p.expansion)} ${p.expansion === 0 ? '(no new relay)' : p.expansion >= 0.9 ? '(whenever possible)' : ''}`.trim());
  out.push(`Aggression: ${pct(p.aggression)} ${p.aggression === 0 ? '(never attack without orders)' : p.aggression >= 0.7 ? '(free raids on weak neighbours)' : '(measured raids)'}`);
  if (p.defendFirst.length) out.push(`Defend first: ${p.defendFirst.map(sysName).join(', ')}`);
  if (p.neverAttack.length) out.push(`Never attack: ${p.neverAttack.map(colName).join(', ')}`);
  if (p.trustedTraders.length) out.push(`Trusted partners: ${p.trustedTraders.map(colName).join(', ')}`);
  for (const r of RESOURCES) if (p.reserves[r] !== undefined) out.push(`${RES[r]!.en} reserve: ${p.reserves[r]}`);
  for (const r of RESOURCES) if (p.sellAbove[r] !== undefined) out.push(`Sell ${RES[r]!.en} surplus from ${p.sellAbove[r]} Credits`);
  for (const r of RESOURCES) if (p.buyBelow[r] !== undefined) out.push(`Buy ${RES[r]!.en} up to ${p.buyBelow[r]} Credits`);
  if (p.fuel !== 'auto') out.push(`Fuel: ${p.fuel === 'refinery' ? 'refineries at gas giants' : 'synthesizers at home'}`);
  out.push(`Automatic turrets: ${p.autoTurrets} per attacked system`);
  out.push(`Fleets retreat below ${pct(p.retreatBelow)} hulls`);
  out.push(`Escort convoys above ${p.escortAbove} Credits of cargo`);
  out.push(`Priority target: ${p.targetPriority}`);
  if (p.notes) out.push(`In one sentence: "${p.notes.slice(0, 200)}"`);
  return out;
}
