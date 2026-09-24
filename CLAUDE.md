# StarNet

Jeu de stratégie web, gratuit, persistant, massivement multijoueur, par ninabot sàrl.
Le document de référence est `docs/GDD.md` : le lire avant toute décision de gameplay.

## Repères

- Vocabulaire fixé : Aurane, Réseau, Signal, Réveil, Silence, Tirage, Marché, Phares, Général, Colonie ;
  factions Concordat / Guilde des Marchands / Oracles / Corsaires ; ressources Métal / Énergie / Vivres / Cristal.
- Frontal Cloudflare ; calcul et données Exoscale (Terraform) ; LLM primaire rog1 (tailnet), repli Infomaniak.
- Contexte ninabot (Exoscale, rog1, Infomaniak, Vaultwarden, CI/CD, conventions) : `docs/ops/context.md`, à lire avant tout travail d'infra.
- Secrets : Vaultwarden uniquement, jamais dans le dépôt. Accès de session : `docs/ops/access.md`.
- Saison 0 : une VM Exoscale + Docker Compose + tunnel Cloudflare (motif ninabot) ; npm workspaces, TypeScript strict, Vitest ; commits `type(scope): description`.
- Toute la simulation (`packages/sim`, pour l'instant `js/`) est déterministe et testée : `npm test`.
- Bilingue FR/EN dès le départ ; code et commits en anglais, documents de design en français.

## Mémoire ninabot

Quand `.claude/memory/corthexis.md` existe (import au démarrage, voir `docs/ops/access.md`),
le lire en premier : il contient le contexte ninabot (stack, partenariats, conventions).
