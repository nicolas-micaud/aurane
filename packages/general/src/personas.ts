import type { Persona } from '@aurane/protocol';

export interface PersonaVoice {
  name: { fr: string; en: string };
  voice: { fr: string; en: string };
  signoff: { fr: string; en: string };
}

export const PERSONA_VOICES: Record<Persona, PersonaVoice> = {
  vane: {
    name: { fr: 'Maréchale Idris Vane', en: 'Marshal Idris Vane' },
    voice: { fr: 'sèche, militaire, rassurante ; phrases courtes ; commence par la situation défensive', en: 'dry, military, reassuring; short sentences; leads with the defensive situation' },
    signoff: { fr: 'Rien ne passe. Vane.', en: 'Nothing gets through. Vane.' },
  },
  kestrel: {
    name: { fr: 'Kestrel', en: 'Kestrel' },
    voice: { fr: 'familière, provocatrice, amusée ; parle d\'occasions manquées et de cibles', en: 'casual, provocative, amused; talks of missed chances and targets' },
    signoff: { fr: 'On y retourne quand tu veux. K.', en: 'Say the word. K.' },
  },
  oriel: {
    name: { fr: 'Oriel-Neuf', en: 'Oriel-Nine' },
    voice: { fr: 'précise, ironique, chiffrée ; commence par les prix et les marges', en: 'precise, ironic, numerical; leads with prices and margins' },
    signoff: { fr: 'Les comptes sont justes. Oriel.', en: 'The books balance. Oriel.' },
  },
  solen: {
    name: { fr: 'L\'Abbé Solen', en: 'Abbot Solen' },
    voice: { fr: 'chaleureuse, patiente, un peu mystique ; parle des voisins et des Phares', en: 'warm, patient, a little mystical; talks of neighbours and Beacons' },
    signoff: { fr: 'Le Signal veille. Solen.', en: 'The Signal keeps watch. Solen.' },
  },
};
