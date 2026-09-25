// The simulation's Draw Counsel (packages/sim, decision 0009) as the source of the General's counsel cards:
// the options are already legal, priced and tier-filtered; this only shapes them for the LLM layer.
import type { CounselOption as VoiceOption, ShowTarget as VoiceShow } from '@aurane/general';
import { counsel, counselLine, counselTitle, type Colony, type CounselOption, type ShowTarget, type World } from '@aurane/sim';

function toShow(s: ShowTarget): VoiceShow {
  switch (s.kind) {
    case 'star': return { screen: 'system', system: s.system };
    case 'link': return { screen: 'system', system: s.from, slot: 'link' }; // slot 'link' = enter link mode from that star
    case 'plateau': return { screen: 'system', system: s.system, ...(s.orbit ? { slot: String(s.orbit) } : {}) };
    case 'tab': return { screen: s.tab === 'log' ? 'journal' : s.tab === 'colony' ? 'colony' : s.tab === 'market' ? 'market' : s.tab === 'general' ? 'general' : 'galaxy' };
  }
}

const RISK: Record<CounselOption['kind'], VoiceOption['risk']> = {
  link_first: 'low', link_more: 'low', warehouse: 'low', antenna: 'low', turret: 'low', defend: 'mid', buy_energy: 'low', sell_surplus: 'low', train: 'low', treaty: 'mid', doctrine: 'low', read_recap: 'low',
};

export function toVoiceOption(o: CounselOption): VoiceOption {
  return {
    id: o.id,
    label: { fr: counselLine(o, 'fr'), en: counselLine(o, 'en') },
    cost: o.cost as VoiceOption['cost'],
    delayMin: 0,
    gain: { fr: counselTitle(o, 'fr'), en: counselTitle(o, 'en') },
    risk: RISK[o.kind],
    command: o.command,
    show: toShow(o.show),
  };
}

/** `GeneralService.counselSource`: up to five options from the simulation, the LLM layer keeps three. */
export const simCounselSource = (w: World, c: Colony): { tier: number; options: VoiceOption[] } => ({ tier: c.onboarding.tier, options: counsel(w, c, 5).map(toVoiceOption) });
