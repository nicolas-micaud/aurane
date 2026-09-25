# Plan — refonte de la couche LLM des Généraux

Date : 25 septembre 2026. Branche `claude/llm-layer` (session locale gmk1), à partir de main `d669e95`.
Commande de Nick : analyse Claude web du 25.09 ; « tu travailles en autonomie ». Aucun déploiement en prod.

## Étape 0 — Cartographie de l'existant

### Le client LLM (`packages/general/src/llm.ts`)

- `OpenAICompatibleClient` : un fournisseur, un sémaphore de concurrence, `fetch` sur `/chat/completions`, timeout
  par requête, `reasoning_effort: none`, `response_format json_object` en option, `extraBody`.
- `FailoverClient` : primaire puis **repli vers un autre modèle** (Apertus 70B) sur erreur, timeout ou saturation
  (file > 8) ; refroidissement 60 s. C'est le point 2 du diagnostic : la voix change en pleine conversation.
- `clientFromEnv` : `LLM_PRIMARY_*` / `LLM_FALLBACK_*` ; défauts de concurrence 2 / 4.
- Paramètres d'échantillonnage passés **par l'appelant** (`temperature`, `maxTokens`) : ils diffèrent d'un point
  d'appel à l'autre mais pas d'un fournisseur à l'autre. Pas de `top_p`. Aucun retry, aucun jitter, pas de
  disjoncteur au sens propre (le primaire est simplement mis de côté 60 s).
- Aucune métrique : le `ChatResult` porte les jetons et la latence, personne ne les agrège.

### Les points d'appel

| Appel | Fichier | Déclencheur | Synchrone ? | Quota | Repli sans modèle |
|---|---|---|---|---|---|
| Dialogue (`converse`) | `converse.ts`, `Engine.talk` | `POST /api/talk` | oui (20 s) | `talk` 60/jour | heuristique + FAQ + blagues |
| Doctrine (`compilePolicy`) | `doctrine.ts`, `Engine.doctrine` | `POST /api/doctrine` | oui (20 s) | `writes` 6/jour | heuristique à mots-clés |
| Briefing (`writeBriefing`) | `briefing.ts`, `Engine.briefing` | `GET /api/briefing` à la connexion | oui (30 s) | `writes` 6/jour, absence ≥ 30 min | gabarit déterministe |
| Gazette (`writeGazette`) | `gazette.ts`, `Engine.gazette` | `GET /api/public/gazette`, `/gazette` (première lecture du jour) | oui (60 s), puis cache mémoire | aucun | gabarit déterministe |
| « Le Général parle le premier » | `alerts.ts`, `Engine.speakFirst` | événement `fleet.inbound` à chaque pas | **aucun appel** (gabarit) | — | — |
| Décisions des Généraux (PNJ et absents) | `packages/sim/src/general.ts` `decide` | toutes les 30 min sim | **aucun appel** (moteur de règles) | — | — |
| Mémoires de fin de saison | — | — | **pas implémenté** | — | — |

**Constat sur le point 1 du diagnostic (panne en cascade au Tirage).** Le Tirage, le tick et la résolution des
combats **n'appellent jamais le modèle** aujourd'hui : `tick()` et `decide()` sont purement déterministes, et
`speakFirst` est un gabarit. Les appels sont tous déclenchés par une requête d'un joueur (dialogue, doctrine,
briefing) ou par la première lecture de la Gazette du jour. Le risque réel est donc **l'heure de pointe humaine**
(un afflux de connexions après le Tirage, chaque connexion demandant un briefing, plus la Gazette à la première
lecture) et non la simulation. La refonte enlève tout de même ces appels du chemin de la requête (file, cache,
lissage) pour que le serveur de jeu ne bloque jamais sur un modèle, et pose la garde-fou structurelle : aucun
module de `packages/sim` ne peut importer le client.

### Le moteur de règles (`packages/sim/src/general.ts`)

`decide(w, colony, tick)` produit des commandes à partir de la `Policy` : marché et troc, bâtiments (tourelles où
ça tire, relais de secours, entrepôts, raffinerie/synthétiseur, extracteur, chantier, bastion, antenne, comptoir),
logistique (cargos, navettes de dépôt, routes), expansion (candidats `linkOptions` notés, refus si l'entretien
projeté dépasse 80 % du revenu d'Énergie), militaire (entraînement, retraite, secours, sorties selon
`aggression`, blocus ou raid d'un pont), pression corsaire, diplomatie, Phares. Il **contient déjà** des analyses
réutilisables (ponts via `findBridges`, projection d'entretien via `networkUpkeep`, systèmes menacés) mais elles
sont internes et non exposées au LLM, qui reçoit aujourd'hui un `situationSummary` brut (stocks, flottes,
systèmes) et doit raisonner seul. C'est le point 3 du diagnostic.

### La personnalité (`personas.ts`)

Quatre fiches en TypeScript (tempérament, humour, style, interdits, spécialité, trois répliques), un mémento des
règles de 30 lignes, deux blagues et une salutation par personnage dans `converse.ts`. Pas d'exemples de
répliques par situation, pas de mémoire (trahisons, alliés, saisons), pas de banque de dégradation : hors quota
ou modèle absent, la réponse heuristique est la même que sans modèle, sans dire au joueur pourquoi.

### La doctrine

`PolicySchema` (zod) valide la sortie du modèle ; les ids inconnus sont filtrés. Pas de décodage contraint, pas de
tentative de réparation, pas de validation sémantique (un `buyBelow` supérieur au `sellAbove` de la même
ressource passe), pas de question de clarification, et la politique s'applique **immédiatement** sans
prévisualisation.

### La sécurité des textes tiers

Les noms de Colonies et d'alliances (choisis par les joueurs) sont injectés tels quels dans les prompts
(`COLONIES: id = nom`). Le message du joueur est borné (1 500 caractères). Aucun test d'injection.

### Persistance disponible

Postgres (`world_snapshots`, `players`, `invites`) via `PgStore`, fichiers JSON en développement. Pas de Redis ni
Valkey dans la pile : la file de jobs vivra dans Postgres (et en fichier en dev).

## Ce qui est livré, dans l'ordre des commits

1. **Client multi-fournisseurs par classe** (`packages/general/src/llm/`) : `ProviderClient` (sémaphore,
   timeout, retries avec backoff exponentiel et jitter, disjoncteur fermé/ouvert/demi-ouvert), `ProviderPool`
   par classe (`voice`, `narrative`) qui essaie les fournisseurs dans l'ordre, saute les disjoncteurs ouverts et
   les files saturées, **refuse tout fournisseur dont le modèle n'est pas celui de la classe**, et lève
   `LlmUnavailable` quand tout est indisponible — jamais de bascule vers un autre modèle. Paramètres
   d'échantillonnage par tâche dans le code (`TASK_PARAMS`), identiques pour tous les fournisseurs. Configuration
   entièrement par variables d'environnement (`LLM_VOICE_PROVIDERS`, `LLM_VOICE_MODEL`, `LLM_PROVIDER_<NOM>_*`,
   idem `NARRATIVE`), avec lecture de compatibilité des anciennes `LLM_PRIMARY_*` / `LLM_FALLBACK_*`.
2. **Métriques** par classe et fournisseur : latence p50/p95, erreurs, ouvertures de disjoncteur, jetons
   entrée/sortie, coût estimé (prix par million configurables), taux de dégradation, profondeur de file.
3. **File de jobs** avec priorités (dialogue > doctrine > briefing > réactions narratives > gazette > PNJ),
   persistée dans Postgres (`llm_jobs`) ou en fichier, lissage par jitter des jobs non urgents, un seul
   ordonnanceur ; **quotas** par joueur, par heure et par jour, configurables.
4. **Analyse déterministe** (`packages/general/src/analysis/`) : ponts critiques et points d'articulation avec
   systèmes perdus, menaces (flottes en approche, ETA, relais exposés, protections), projection d'Énergie sur N
   Tirages avec les relais qui s'éteindraient en premier (dans l'ordre exact du moteur), économie (surplus,
   déficits, écarts de prix entre régions, arbitrage), Phares (distance, coût, tenant), 3 à 5 options chiffrées
   filtrées par la doctrine. Rendu compact pour le prompt, ensemble des nombres autorisés pour la vérification
   des chiffres cités.
5. **Personnalité** : fiches JSON versionnées FR/EN par Général (histoire, obsessions, tics, adresse, tabous,
   humour, crise, 8 à 10 répliques par situation, banque de dégradation), rotation des exemples, règles de ton,
   mémoire structurée du Général (faits tirés des événements + formules récentes à ne pas répéter, persistées).
6. **Doctrine** : schéma JSON strict (décodage contraint `json_schema` quand le fournisseur le supporte, sinon
   validation + une réparation), validation sémantique, question de clarification unique en personnage, aperçu
   lisible avant activation (`pending` + confirmation ; activé par `DOCTRINE_CONFIRM=1`, l'ancien comportement
   immédiat reste le défaut tant que le client n'a pas l'écran de confirmation).
7. **Dialogue, briefing, Gazette** rebranchés sur la nouvelle couche : le Général reçoit l'analyse, pas l'état
   brut ; textes tiers délimités comme données ; vérification des chiffres en post-traitement ; dégradation en
   personnage. Tests d'injection.
8. **Intégration world** : ordonnanceur démarré avec le serveur, briefing paresseux mis en cache jusqu'au prochain
   événement significatif, Gazette en lot hors pointe, endpoints admin de métriques et de confirmation de
   doctrine. Rien dans `step()`.
9. **Banc des personas** (`tools/persona-bench`) : scénarios fixes × Généraux × langues × fournisseurs, mode
   enregistré et mode réel, rapport `docs/ai/persona-report.md`.
10. **Projection de capacité** (`tools/llm-capacity`) à partir des métriques.
11. `docs/ai/ARCHITECTURE.md`, variables de déploiement, décision `0008`.

## Ce que je ne fais pas (et pourquoi)

- Pas de modification de `packages/sim` au-delà d'exports en lecture si nécessaire : le moteur reste 100 %
  déterministe et appartient à la session cloud.
- Pas de nouveau champ dans l'instantané du monde : la mémoire du Général et la file de jobs vivent dans le
  magasin du serveur (Postgres / fichiers), pas dans `World`.
- Pas d'écran client : le serveur expose la prévisualisation de doctrine et la confirmation ; le câblage dans
  `apps/web` revient à la session cloud (noté dans la PR).
- Pas de mémoires de fin de saison : la classe `narrative` et la file sont prêtes pour les porter, la rédaction
  elle-même est une décision de contenu.
