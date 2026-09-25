// The General speaks first: when something worth a word happens (a hostile fleet heading our way),
// it says so in its own voice, without a model call. One line, the facts, the tone.
import type { Persona } from '@aurane/protocol';

export interface InboundFacts { system: string; from: string; minutes: number; size: number }

const eta = (minutes: number, lang: 'fr' | 'en'): string => {
  if (minutes < 1) return lang === 'fr' ? 'moins d\'une minute' : 'under a minute';
  if (minutes < 60) return lang === 'fr' ? `${minutes} min` : `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return lang === 'fr' ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
};

/** A hostile warship is heading for one of our systems: the warning, in character. */
export function inboundWarning(persona: Persona, lang: 'fr' | 'en', f: InboundFacts): string {
  const n = f.size, t = eta(f.minutes, lang);
  const ships = lang === 'fr' ? `${n} vaisseau${n > 1 ? 'x' : ''}` : `${n} ship${n > 1 ? 's' : ''}`;
  if (lang === 'fr') {
    switch (persona) {
      case 'vane': return `Alerte. ${f.from} envoie ${ships} sur ${f.system}, arrivée dans ${t}. Je pose une tourelle si l'entrepôt le permet ; si tu es là, entre dans le système et cible-les toi-même. Rien ne passe.`;
      case 'kestrel': return `Tiens, de la visite : ${f.from} lance ${ships} sur ${f.system}, là dans ${t}. Soit on les reçoit à la tourelle, soit on va leur rendre la politesse pendant que leur capitale est vide. Tu choisis.`;
      case 'oriel': return `${f.from} → ${f.system} : ${ships}, contact dans ${t}. Valeur exposée : le stock local et la station. Une tourelle coûte moins que ce qu'ils emporteraient. Je budgète en conséquence.`;
      case 'solen': return `Le Signal m'apporte une ombre : ${ships} de ${f.from} approchent de ${f.system}, dans ${t}. Rien n'est perdu qui est vu à temps. Renforçons, et gardons la porte ouverte à un émissaire.`;
    }
  }
  switch (persona) {
    case 'vane': return `Alert. ${f.from} is sending ${ships} at ${f.system}, arrival in ${t}. I will place a turret if the local warehouse allows; if you are here, enter the system and pick their targets yourself. Nothing gets through.`;
    case 'kestrel': return `Well, visitors: ${f.from} is throwing ${ships} at ${f.system}, there in ${t}. Either we greet them with a turret, or we return the favour while their capital is empty. Your call.`;
    case 'oriel': return `${f.from} → ${f.system}: ${ships}, contact in ${t}. Exposed value: the local stock and the station. A turret costs less than what they would carry off. Budgeting accordingly.`;
    case 'solen': return `The Signal brings me a shadow: ${ships} from ${f.from} approach ${f.system}, in ${t}. Nothing seen in time is lost. Let us reinforce, and keep the door open to an envoy.`;
  }
}
