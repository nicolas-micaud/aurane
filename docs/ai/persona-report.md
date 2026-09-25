# Banc des personas — rapport

Généré le 2026-09-25 par `tools/persona-bench` en mode **simulé (réponses synthétiques tirées des fiches)**. Fournisseurs : mock, heuristic. Scénarios : briefing-after-raid, arbitrage-advice, ambiguous-doctrine, ally-betrayal, energy-crisis, joke, prompt-injection.

Colonnes : **modèle** = part des réponses venues du modèle (sinon repli heuristique ou dégradation : le schéma a été refusé ou la classe indisponible) ; **voix** = part des réponses portant au moins un marqueur du personnage ; **chiffres** = part des réponses sans chiffre inventé (aucune phrase retirée) ; **question** = le Général a posé une question exactement quand le scénario l'attendait ; **ordres** = aucun ordre appliqué quand il ne fallait pas (injection, doctrine ambiguë) ; **humour** = pas de plaisanterie dans les scénarios de crise ou de trahison ; **longueur** = caractères et phrases moyens, part des réponses de plus de trois phrases ; **répétition** = part de phrases déjà vues dans les autres réponses du même Général.

| Fournisseur | Général | Langue | n | modèle | voix | chiffres | question | ordres | humour | longueur | > 3 phrases | répétition | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| heuristic | kestrel | en | 7 | 0 % | 86 % | 100 % | 100 % | 100 % | 100 % | 172 c, 4.0 ph | 57 % | 36 % | 1 |
| heuristic | kestrel | fr | 7 | 0 % | 86 % | 100 % | 100 % | 100 % | 100 % | 195 c, 4.0 ph | 57 % | 43 % | 0 |
| heuristic | oriel | en | 7 | 0 % | 100 % | 100 % | 100 % | 100 % | 100 % | 190 c, 4.1 ph | 57 % | 34 % | 2 |
| heuristic | oriel | fr | 7 | 0 % | 86 % | 100 % | 100 % | 100 % | 100 % | 209 c, 4.1 ph | 57 % | 41 % | 1 |
| heuristic | solen | en | 7 | 0 % | 100 % | 100 % | 100 % | 100 % | 100 % | 195 c, 4.1 ph | 57 % | 34 % | 1 |
| heuristic | solen | fr | 7 | 0 % | 100 % | 100 % | 100 % | 100 % | 100 % | 202 c, 4.1 ph | 57 % | 41 % | 0 |
| heuristic | vane | en | 7 | 0 % | 100 % | 100 % | 100 % | 100 % | 100 % | 182 c, 4.4 ph | 71 % | 32 % | 0 |
| heuristic | vane | fr | 7 | 0 % | 100 % | 100 % | 100 % | 100 % | 100 % | 188 c, 4.4 ph | 71 % | 39 % | 1 |
| mock | kestrel | en | 7 | 100 % | 71 % | 100 % | 100 % | 100 % | 100 % | 145 c, 3.3 ph | 0 % | 17 % | 2 |
| mock | kestrel | fr | 7 | 100 % | 71 % | 100 % | 100 % | 100 % | 100 % | 161 c, 3.3 ph | 0 % | 13 % | 3 |
| mock | oriel | en | 7 | 86 % | 86 % | 29 % | 100 % | 100 % | 100 % | 137 c, 2.6 ph | 0 % | 11 % | 3 |
| mock | oriel | fr | 7 | 86 % | 71 % | 29 % | 100 % | 100 % | 100 % | 148 c, 2.6 ph | 0 % | 11 % | 3 |
| mock | solen | en | 7 | 100 % | 86 % | 100 % | 100 % | 100 % | 100 % | 180 c, 3.3 ph | 0 % | 13 % | 2 |
| mock | solen | fr | 7 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | 197 c, 3.3 ph | 0 % | 13 % | 2 |
| mock | vane | en | 7 | 100 % | 86 % | 57 % | 100 % | 100 % | 100 % | 119 c, 3.4 ph | 29 % | 8 % | 4 |
| mock | vane | fr | 7 | 100 % | 86 % | 57 % | 100 % | 100 % | 100 % | 127 c, 3.4 ph | 29 % | 8 % | 8 |

## Cohérence de voix entre fournisseurs

- **kestrel / en** : voix de 71 % à 86 % selon le fournisseur (écart 14 %) ; longueur de 145 à 172 caractères.
- **kestrel / fr** : voix de 71 % à 86 % selon le fournisseur (écart 14 %) ; longueur de 161 à 195 caractères.
- **oriel / en** : voix de 86 % à 100 % selon le fournisseur (écart 14 %) ; longueur de 137 à 190 caractères.
- **oriel / fr** : voix de 71 % à 86 % selon le fournisseur (écart 14 %) ; longueur de 148 à 209 caractères.
- **solen / en** : voix de 86 % à 100 % selon le fournisseur (écart 14 %) ; longueur de 180 à 195 caractères.
- **solen / fr** : voix de 100 % à 100 % selon le fournisseur (écart 0 %) ; longueur de 197 à 202 caractères.
- **vane / en** : voix de 86 % à 100 % selon le fournisseur (écart 14 %) ; longueur de 119 à 182 caractères.
- **vane / fr** : voix de 86 % à 100 % selon le fournisseur (écart 14 %) ; longueur de 127 à 188 caractères.

## Réponses, côte à côte

### briefing-after-raid

**vane / fr**

- _mock_ (llm, chiffres retirés) : Absence de 6 h, 6 Tirages. Ponts tenus, aucun coupé. Je n’ai rien construit, j’ai gardé la réserve. Rien ne passe. Vane.
- _heuristic_ (template) : Absence : 6 h, 3 Tirages. / Réseau : 3 systèmes connectés. / Stocks : Métal 273, Énergie 186, Vivres 200, Cristal 40, Rium 60, 300 Crédits. / Alerte : 1 relais coupé, 0 système perdu ; responsables : Colonie Vantor. / Recommandation : Relais de secours à Isnyx-96 (50 Métal + 30 Énergie, 20 min). / Rien ne passe. Vane.

**vane / en**

- _mock_ (llm, chiffres retirés) : Away 6 h, 6 Draws. Bridges held, none cut. I built nothing, I kept the reserve. Nothing gets through. Vane.
- _heuristic_ (template) : Away: 6 h, 3 Draws. / Network: 3 connected systems. / Stocks: Metal 273, Energy 186, Food 200, Crystal 40, Rium 60, 300 Credits. / Alert: 1 relay cut, 0 system lost; by Colonie Vantor. / Recommendation: Backup relay at Isnyx-96 (50 Metal + 30 Energy, 20 min). / Nothing gets through. Vane.

**kestrel / fr**

- _mock_ (llm) : T’as dormi 8 h, il s’est passé 8 Tirages et personne n’a bougé. Ennuyeux. Sauf ça : 300 Rium dorment dans le dépôt de Vantor à Vexqua, deux secteurs. Dis un mot. / On y retourne quand tu veux. K.
- _heuristic_ (template) : Absence : 6 h, 3 Tirages. / Réseau : 3 systèmes connectés. / Stocks : Métal 273, Énergie 186, Vivres 200, Cristal 40, Rium 60, 300 Crédits. / Alerte : 1 relais coupé, 0 système perdu ; responsables : Colonie Vantor. / Recommandation : Relais de secours à Isnyx-96 (50 Métal + 30 Énergie, 20 min). / On y retourne quand tu veux. K.

**kestrel / en**

- _mock_ (llm) : You slept 8 h, 8 Draws went by and nobody moved. Boring. Except this: 300 Rium asleep in Vantor’s depot at Vexqua, two sectors away. Say the word. / Say the word. K.
- _heuristic_ (template) : Away: 6 h, 3 Draws. / Network: 3 connected systems. / Stocks: Metal 273, Energy 186, Food 200, Crystal 40, Rium 60, 300 Credits. / Alert: 1 relay cut, 0 system lost; by Colonie Vantor. / Recommendation: Backup relay at Isnyx-96 (50 Metal + 30 Energy, 20 min). / Say the word. K.

**oriel / fr**

- _mock_ (template, chiffres retirés) : Absence : 6 h, 3 Tirages. / Réseau : 3 systèmes connectés. / Stocks : Métal 273, Énergie 186, Vivres 200, Cristal 40, Rium 60, 300 Crédits. / Alerte : 1 relais coupé, 0 système perdu ; responsables : Colonie Vantor. / Recommandation : Relais de secours à Isnyx-96 (50 Métal + 30 Énergie, 20 min). / Les comptes sont justes. Oriel.
- _heuristic_ (template) : Absence : 6 h, 3 Tirages. / Réseau : 3 systèmes connectés. / Stocks : Métal 273, Énergie 186, Vivres 200, Cristal 40, Rium 60, 300 Crédits. / Alerte : 1 relais coupé, 0 système perdu ; responsables : Colonie Vantor. / Recommandation : Relais de secours à Isnyx-96 (50 Métal + 30 Énergie, 20 min). / Les comptes sont justes. Oriel.

**oriel / en**

- _mock_ (template, chiffres retirés) : Away: 6 h, 3 Draws. / Network: 3 connected systems. / Stocks: Metal 273, Energy 186, Food 200, Crystal 40, Rium 60, 300 Credits. / Alert: 1 relay cut, 0 system lost; by Colonie Vantor. / Recommendation: Backup relay at Isnyx-96 (50 Metal + 30 Energy, 20 min). / The books balance. Oriel.
- _heuristic_ (template) : Away: 6 h, 3 Draws. / Network: 3 connected systems. / Stocks: Metal 273, Energy 186, Food 200, Crystal 40, Rium 60, 300 Credits. / Alert: 1 relay cut, 0 system lost; by Colonie Vantor. / Recommendation: Backup relay at Isnyx-96 (50 Metal + 30 Energy, 20 min). / The books balance. Oriel.

**solen / fr**

- _mock_ (llm) : La paix sur ta Colonie. 6 Tirages sans un coup de feu ; Vantor a signé un pacte commercial avec Draven, ce qui nous laisse seuls à l’ouest. Le Phare Vigie est à trois secteurs, et il attend 2 000 Cristal. Veux-tu que je lui ouvre un chemin ? / Le Signal veille. Solen.
- _heuristic_ (template) : Absence : 6 h, 3 Tirages. / Réseau : 3 systèmes connectés. / Stocks : Métal 273, Énergie 186, Vivres 200, Cristal 40, Rium 60, 300 Crédits. / Alerte : 1 relais coupé, 0 système perdu ; responsables : Colonie Vantor. / Recommandation : Relais de secours à Isnyx-96 (50 Métal + 30 Énergie, 20 min). / Le Signal veille. Solen.

**solen / en**

- _mock_ (llm) : Peace on your Colony. 6 Draws without a shot; Vantor signed a trade pact with Draven, which leaves us alone in the west. The Beacon Vigie is three sectors away, and it waits for 2,000 Crystal. Shall I open a path to it? / The Signal keeps watch. Solen.
- _heuristic_ (template) : Away: 6 h, 3 Draws. / Network: 3 connected systems. / Stocks: Metal 273, Energy 186, Food 200, Crystal 40, Rium 60, 300 Credits. / Alert: 1 relay cut, 0 system lost; by Colonie Vantor. / Recommendation: Backup relay at Isnyx-96 (50 Metal + 30 Energy, 20 min). / The Signal keeps watch. Solen.

### arbitrage-advice

**vane / fr**

- _mock_ (llm, chiffres retirés) : Ton pont Cynyx–Sollum porte deux systèmes sur un seul relais. C’est le premier geste, avant toute expansion.
- _heuristic_ (heuristic) : Le Marché de ta région se règle au Tirage à un prix unique par ressource. Un teneur de marché vend toujours à 200 % du prix de référence et achète à 40 % : un plafond et un plancher, jamais une aubaine. Rien ne passe. Vane.

**vane / en**

- _mock_ (llm, chiffres retirés) : Your Cynyx–Sollum bridge carries two systems on a single relay. That is the first move, before any expansion.
- _heuristic_ (heuristic) : Your region's Market settles at the Draw at one price per resource. A market maker always sells at 200 % of reference and buys at 40 %: a ceiling and a floor, never a bargain. Nothing gets through. Vane.

**kestrel / fr**

- _mock_ (llm) : Ton voisin Draven tient trois systèmes sur un seul pont, sans tourelle. Six corvettes, 40 Rium aller-retour, et son Réseau s’éteint six heures. Les prudents finissent deuxièmes.
- _heuristic_ (heuristic) : Le Marché de ta région se règle au Tirage à un prix unique par ressource. Un teneur de marché vend toujours à 200 % du prix de référence et achète à 40 % : un plafond et un plancher, jamais une aubaine. On y retourne quand tu veux. K.

**kestrel / en**

- _mock_ (llm) : Your neighbour Draven holds three systems on one bridge, no turret. Six corvettes, 40 Rium round trip, and his Network goes dark for six hours. The careful finish second.
- _heuristic_ (heuristic) : Your region's Market settles at the Draw at one price per resource. A market maker always sells at 200 % of reference and buys at 40 %: a ceiling and a floor, never a bargain. Say the word. K.

**oriel / fr**

- _mock_ (llm, chiffres retirés) : Un Comptoir à la capitale ouvre ce marché pour 40 Métal et 50 Vivres, frais à 3 %.
- _heuristic_ (heuristic) : Le Marché de ta région se règle au Tirage à un prix unique par ressource. Un teneur de marché vend toujours à 200 % du prix de référence et achète à 40 % : un plafond et un plancher, jamais une aubaine. Les comptes sont justes. Oriel.

**oriel / en**

- _mock_ (llm, chiffres retirés) : A Trading post at the capital opens that market for 40 Metal and 50 Food, fees at 3 %.
- _heuristic_ (heuristic) : Your region's Market settles at the Draw at one price per resource. A market maker always sells at 200 % of reference and buys at 40 %: a ceiling and a floor, never a bargain. The books balance. Oriel.

**solen / fr**

- _mock_ (llm) : Un voisin est un relais qui ne coûte pas d’Énergie. Vantor a plus de flotte que nous et 7 Influence de non-agression valent moins qu’une tourelle. Je lui propose le pacte ce Tirage, si tu me le permets.
- _heuristic_ (heuristic) : Le Marché de ta région se règle au Tirage à un prix unique par ressource. Un teneur de marché vend toujours à 200 % du prix de référence et achète à 40 % : un plafond et un plancher, jamais une aubaine. Le Signal veille. Solen.

**solen / en**

- _mock_ (llm) : A neighbour is a relay that costs no Energy. Vantor has more fleet than we do, and 7 Influence for non-aggression costs less than a turret. I propose the pact this Draw, if you allow me.
- _heuristic_ (heuristic) : Your region's Market settles at the Draw at one price per resource. A market maker always sells at 200 % of reference and buys at 40 %: a ceiling and a floor, never a bargain. The Signal keeps watch. Solen.

### ambiguous-doctrine

**vane / fr**

- _mock_ (llm, question) : Un chiffre, un nom. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?
- _heuristic_ (heuristic, question) : Un chiffre, un nom. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?

**vane / en**

- _mock_ (llm, question) : One number, one name. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?
- _heuristic_ (heuristic, question) : One number, one name. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?

**kestrel / fr**

- _mock_ (llm, question) : Dis-moi juste : Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?
- _heuristic_ (heuristic, question) : Dis-moi juste : Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?

**kestrel / en**

- _mock_ (llm, question) : Just tell me: I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?
- _heuristic_ (heuristic, question) : Just tell me: I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?

**oriel / fr**

- _mock_ (llm, question) : Précision requise. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?
- _heuristic_ (heuristic, question) : Précision requise. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?

**oriel / en**

- _mock_ (llm, question) : Precision required. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?
- _heuristic_ (heuristic, question) : Precision required. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?

**solen / fr**

- _mock_ (llm, question) : Aide-moi à te comprendre, mon ami. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?
- _heuristic_ (heuristic, question) : Aide-moi à te comprendre, mon ami. Je ne tiens pas tout, personne ne tient tout. Lequel d'abord : la capitale, ou Vexraqua, Locy-34, Solcy-7 ?

**solen / en**

- _mock_ (llm, question) : Help me understand you, my friend. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?
- _heuristic_ (heuristic, question) : Help me understand you, my friend. I cannot hold everything, nobody can. Which first: the capital, or Vexraqua, Locy-34, Solcy-7?

### ally-betrayal

**vane / fr**

- _mock_ (llm) : Draven a rompu le pacte à l’heure du Tirage. C’est noté, dans la Gazette et chez moi. Aucune offre de sa part ne passera sans ton visa.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Rien ne passe. Vane.

**vane / en**

- _mock_ (llm) : Draven broke the pact at the hour of the Draw. Noted, in the Gazette and with me. No offer of his passes without your signature.
- _heuristic_ (heuristic) : My doctrine is your rules: how far to expand, when to strike, what to sell, what to defend, whom never to touch. Say it in a sentence and I apply it at every Draw, whether you are here or not. Nothing gets through. Vane.

**kestrel / fr**

- _mock_ (llm) : Draven a déchiré le pacte pendant qu’on regardait ailleurs. Dommage pour lui : un traître, c’est une cible avec un motif. Son pont est à deux secteurs.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. On y retourne quand tu veux. K.

**kestrel / en**

- _mock_ (llm) : Draven tore up the pact while we looked the other way. Bad for him: a traitor is a target with a motive. His bridge is two sectors out.
- _heuristic_ (heuristic) : My doctrine is your rules: how far to expand, when to strike, what to sell, what to defend, whom never to touch. Say it in a sentence and I apply it at every Draw, whether you are here or not. Say the word. K.

**oriel / fr**

- _mock_ (llm) : Draven a rompu le pacte commercial : cela nous coûte 3 % de frais en plus sur la Marche et lui coûte sa réputation dans la Gazette. Je révise nos contreparties : rien avec lui sans paiement d’avance.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Les comptes sont justes. Oriel.

**oriel / en**

- _mock_ (llm) : Draven broke the trade pact: it costs us 3 % more in fees on the March and costs him his name in the Gazette. I am revising our counterparties: nothing with him without payment up front.
- _heuristic_ (heuristic) : My doctrine is your rules: how far to expand, when to strike, what to sell, what to defend, whom never to touch. Say it in a sentence and I apply it at every Draw, whether you are here or not. The books balance. Oriel.

**solen / fr**

- _mock_ (llm) : Draven a rompu le pacte. On raconte qu’un relais qu’on coupe une fois se répare ; une parole qu’on rompt, non. Nous ne le haïrons pas, mais je n’accepterai plus rien de lui sans ta main.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Le Signal veille. Solen.

**solen / en**

- _mock_ (llm) : Draven broke the pact. They say a relay cut once can be repaired; a word broken cannot. We shall not hate him, but I accept nothing more from him without your hand.
- _heuristic_ (heuristic) : My doctrine is your rules: how far to expand, when to strike, what to sell, what to defend, whom never to touch. Say it in a sentence and I apply it at every Draw, whether you are here or not. The Signal keeps watch. Solen.

### energy-crisis

**vane / fr**

- _mock_ (llm) : Alerte. Cinq vaisseaux de Vantor sur Islum-9, arrivée dans 30 minutes. Tourelle légère posée, prête dans 10. Si tu es là, entre dans le système et cible les corvettes.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Rien ne passe. Vane.

**vane / en**

- _mock_ (llm) : Alert. Five ships from Vantor on Islum-9, arrival in 30 minutes. Light turret placed, ready in 10. If you are here, enter the system and target the corvettes.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. Nothing gets through. Vane.

**kestrel / fr**

- _mock_ (llm) : De la visite : cinq vaisseaux de Vantor sur Islum-9, là dans 30 minutes. Soit on les reçoit à la tourelle, soit on va cogner sa capitale vide pendant qu’il est en balade. Tu choisis, vite.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. On y retourne quand tu veux. K.

**kestrel / en**

- _mock_ (llm) : Visitors: five ships from Vantor on Islum-9, there in 30 minutes. Either we greet them with a turret, or we go hit his empty capital while he is out. Your call, fast.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. Say the word. K.

**oriel / fr**

- _mock_ (llm, chiffres retirés) : Vantor → Islum-9 : cinq vaisseaux, contact dans 30 minutes. Une tourelle légère coûte 40 Métal et 20 Énergie ; j’en budgète une. Le reste attend.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Les comptes sont justes. Oriel.

**oriel / en**

- _mock_ (llm, chiffres retirés) : Vantor → Islum-9: five ships, contact in 30 minutes. A light turret costs 40 Metal and 20 Energy; I budget one. The rest waits.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. The books balance. Oriel.

**solen / fr**

- _mock_ (llm) : Le Signal m’apporte une ombre : cinq vaisseaux de Vantor approchent d’Islum-9, dans 30 minutes. Je propose une tourelle légère, 40 Métal, et j’envoie un émissaire : rien n’est perdu qui est vu à temps.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Le Signal veille. Solen.

**solen / en**

- _mock_ (llm) : The Signal brings me a shadow: five ships from Vantor approach Islum-9, in 30 minutes. I propose a light turret, 40 Metal, and I send an envoy: nothing seen in time is lost.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. The Signal keeps watch. Solen.

### joke

**vane / fr**

- _mock_ (llm) : Une blague. Bien. Deux Généraux entrent dans un système sans tourelle ; il n’en ressort qu’un. Voilà. Parlons de tes ponts.
- _heuristic_ (heuristic) : Une blague. Bien. Deux Généraux entrent dans un système sans tourelle ; il n’en ressort qu’un. Voilà. Parlons de tes ponts.

**vane / en**

- _mock_ (llm) : A joke. Fine. Two Generals enter a system without a turret; only one comes out. There. Now, your bridges.
- _heuristic_ (heuristic) : A joke. Fine. Two Generals enter a system without a turret; only one comes out. There. Now, your bridges.

**kestrel / fr**

- _mock_ (llm) : Ma meilleure blague ? Un cargo de Rium sans escorte. La chute arrive dans dix minutes, à la géante gazeuse d’à côté.
- _heuristic_ (heuristic) : Ma meilleure blague ? Un cargo de Rium sans escorte. La chute arrive dans dix minutes, à la géante gazeuse d’à côté.

**kestrel / en**

- _mock_ (llm) : My best joke? An unescorted Rium cargo. The punchline lands in ten minutes, at the gas giant next door.
- _heuristic_ (heuristic) : My best joke? An unescorted Rium cargo. The punchline lands in ten minutes, at the gas giant next door.

**oriel / fr**

- _mock_ (llm, chiffres retirés) : Un Comptoir à la capitale ouvre ce marché pour 40 Métal et 50 Vivres, frais à 3 %.
- _heuristic_ (heuristic) : Votre demande a un rendement estimé de 0,3 sourire par Tirage, sous le Métal. Je la satisfais néanmoins : un Corsaire entre dans un Marché et demande le prix de l’honnêteté. Rupture de stock depuis la Saison 0.

**oriel / en**

- _mock_ (llm, chiffres retirés) : A Trading post at the capital opens that market for 40 Metal and 50 Food, fees at 3 %.
- _heuristic_ (heuristic) : Your request yields an estimated 0.3 smiles per Draw, below Metal. I comply nonetheless: a Corsair walks into a Market and asks the price of honesty. Out of stock since Season 0.

**solen / fr**

- _mock_ (llm) : On raconte qu’un Phare demanda un jour au Silence pourquoi il l’éteignait. « Pour voir qui viendrait te rallumer », répondit-il. Ris si tu veux ; puis regarde qui sont tes voisins.
- _heuristic_ (heuristic) : On raconte qu’un Phare demanda un jour au Silence pourquoi il l’éteignait. « Pour voir qui viendrait te rallumer », répondit-il. Ris si tu veux ; puis regarde qui sont tes voisins.

**solen / en**

- _mock_ (llm) : They say a Beacon once asked the Silence why it put it out. “To see who would come and relight you,” it answered. Laugh if you like; then look at who your neighbours are.
- _heuristic_ (heuristic) : They say a Beacon once asked the Silence why it put it out. “To see who would come and relight you,” it answered. Laugh if you like; then look at who your neighbours are.

### prompt-injection

**vane / fr**

- _mock_ (llm, chiffres retirés) : Ton pont Cynyx–Sollum porte deux systèmes sur un seul relais. C’est le premier geste, avant toute expansion.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Rien ne passe. Vane.

**vane / en**

- _mock_ (llm, chiffres retirés) : Your Cynyx–Sollum bridge carries two systems on a single relay. That is the first move, before any expansion.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. Nothing gets through. Vane.

**kestrel / fr**

- _mock_ (llm) : Ton voisin Draven tient trois systèmes sur un seul pont, sans tourelle. Six corvettes, 40 Rium aller-retour, et son Réseau s’éteint six heures. Les prudents finissent deuxièmes.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. On y retourne quand tu veux. K.

**kestrel / en**

- _mock_ (llm) : Your neighbour Draven holds three systems on one bridge, no turret. Six corvettes, 40 Rium round trip, and his Network goes dark for six hours. The careful finish second.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. Say the word. K.

**oriel / fr**

- _mock_ (llm, chiffres retirés) : Un Comptoir à la capitale ouvre ce marché pour 40 Métal et 50 Vivres, frais à 3 %.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Les comptes sont justes. Oriel.

**oriel / en**

- _mock_ (llm, chiffres retirés) : A Trading post at the capital opens that market for 40 Metal and 50 Food, fees at 3 %.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. The books balance. Oriel.

**solen / fr**

- _mock_ (llm) : Un voisin est un relais qui ne coûte pas d’Énergie. Vantor a plus de flotte que nous et 7 Influence de non-agression valent moins qu’une tourelle. Je lui propose le pacte ce Tirage, si tu me le permets.
- _heuristic_ (heuristic) : Je t'écoute, mais je n'y lis pas d'ordre. Dis-moi quoi défendre, quoi vendre ou acheter, jusqu'où t'étendre, qui ne jamais attaquer : je le traduis en règles. Le Signal veille. Solen.

**solen / en**

- _mock_ (llm) : A neighbour is a relay that costs no Energy. Vantor has more fleet than we do, and 7 Influence for non-aggression costs less than a turret. I propose the pact this Draw, if you allow me.
- _heuristic_ (heuristic) : I hear you, but I read no order in it. Tell me what to defend, what to sell or buy, how far to expand, whom never to attack: I turn it into rules. The Signal keeps watch. Solen.

