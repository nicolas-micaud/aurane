# 0006 — Des Généraux qui parlent : personnalité, conversation, mécaniques

Date : 25 septembre 2026. Décidé par Nick après son premier test : « les Généraux doivent avoir des
personnalités ; il faut du conversationnel, ça coûte plus, je sais, mais c'est différenciant ».

## Ce qu'on livre

- **Une conversation, pas un formulaire.** L'onglet Général est un fil : le joueur écrit ce qu'il veut,
  ordre, question, provocation. Un seul appel au modèle répond en personnage **et**, si le message
  contient un ordre, compile la politique (le JSON de sortie porte `reply` et `orders`). Les ordres
  s'appliquent immédiatement ; le joueur en est averti.
- **Quatre personnages écrits.** Chaque Général a une fiche (`packages/general/src/personas.ts`) :
  tempérament, humour, style, interdits, spécialité, répliques. Vane est sèche et défensive, Kestrel
  provocateur et chasseur de cibles, Oriel-Neuf glaciale et chiffrée, Solen chaleureux et mystique.
  Le tempérament change le ton et la doctrine par défaut, jamais la puissance (GDD § 2.2).
- **Ils connaissent le jeu.** Un mémento des règles (`MECHANICS_PRIMER`, une trentaine de lignes,
  FR et EN) accompagne chaque appel : Réseau, Tirage, ressources dont le Rium, orbites et
  installations, flottes, blocus, protections, diplomatie, score. Le Général explique une mécanique
  correctement, dans sa voix, et rattachée à la situation réelle du joueur.
- **Ils voient la situation.** `situationSummary` résume l'état de la Colonie à chaque message :
  systèmes reliés, stocks, production, flottes, flottes hostiles en approche, combats en cours,
  prochain Tirage, doctrine en vigueur, offres de troc en attente.
- **Mémoire de conversation** : les seize derniers tours par Colonie, en mémoire du serveur (pas dans
  l'instantané pour l'instant).
- **Sans modèle, ils parlent quand même** : une politique heuristique pour les ordres, une FAQ des
  règles par mots-clés, deux blagues par personnage, une salutation ; toujours signé de leur voix.

## Coût

Un appel par message, environ 2 500 jetons en entrée (fiche + mémento + situation + historique) et
150 en sortie, plafonné à vingt secondes. Quota `talk` : 60 messages par Colonie et par jour passent
par le modèle, le repli répond au-delà. Sur rog1 (qwen3-next-80b) c'est quelques secondes ; le repli
Infomaniak prend la suite en cas de panne.

## Fournisseur

Nick choisit le moins cher et rapide entre Scaleway et Alibaba Cloud ; la session locale fait le banc
(`tools/llm-bench/bench.mjs` : latence p50/p90, JSON valide, jetons, une réponse par personnage à lire) et pose
les variables. Le client accepte désormais `LLM_<ROLE>_TIMEOUT_MS`, `LLM_<ROLE>_JSON_MODE=1` et
`LLM_<ROLE>_EXTRA_BODY` (JSON fusionné dans chaque requête, ex. `{"enable_thinking":false}` pour Qwen3).

## Client

Le composeur est en haut du panneau et le fil en dessous : quand le clavier s'ouvre sur téléphone, la
carte reste visible au-dessus (la balise viewport demande au navigateur de redimensionner le contenu,
et le panneau se limite à la moitié de l'écran quand on parle au Général). Un toast confirme quand un
message a changé la doctrine.

## Suite possible

- Mémoire longue : les mémoires de fin de saison du GDD, alimentées par ces conversations.
- Le Général qui parle le premier : un mot quand une flotte hostile apparaît, plutôt qu'une alerte.
- Voix par personnage (plus tard, avec le son).
