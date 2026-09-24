# Bêta fermée : variables et procédure

Décidé le 24.09.2026. Une saison courte (7 jours) sur playaurane.com, 20 à 30 joueurs invités.

## Variables d'environnement du world server

| Variable | Rôle | Valeur bêta |
|---|---|---|
| `REQUIRE_INVITE` | une nouvelle Colonie exige un code d'invitation | `1` |
| `INVITE_CODES` | codes d'amorçage, séparés par des virgules, utilisables une fois chacun | quelques codes pour les premiers testeurs, le reste par l'admin |
| `ADMIN_TOKEN` | jeton des routes `/api/admin/*` (en-tête `x-admin-token`) ; absent = routes désactivées | secret Vaultwarden, 32 octets aléatoires |
| `AUTH_SECRET` | signe les liens d'appareil (`/#join=…`, 24 h) ; absent = aléatoire par processus, les liens meurent au redémarrage | secret Vaultwarden, 32 octets aléatoires |
| `PUBLIC_ORIGIN` | origine des liens d'appareil | `https://play.playaurane.com` |
| `SEASON_SEED` | graine de la saison ; changer la graine = nouvelle galaxie | `beta-1` |
| `SEASON_DAYS` | durée de la saison | `7` |

Les secrets vivent dans Vaultwarden, puis dans l'env de la VM ; jamais dans le dépôt.

## Invitations

```
curl -X POST https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"count": 10, "note": "vague 1"}'
curl https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN"
```

Un code a la forme `AUR-XXXXXXXX` (alphabet sans 0/O/1/I), insensible à la casse, à usage unique.

## Comptes

Pas d'e-mail ni de mot de passe en bêta fermée : le jeton d'appareil est le compte. Pour jouer depuis
un second appareil, « Lier un autre appareil » dans le panneau du Général donne un lien valable 24 h
qui ouvre la même Colonie ; la page d'accueil accepte aussi ce lien collé. Un joueur qui perd tous ses
appareils demande un nouveau lien à l'admin (à ajouter si le besoin apparaît : `/api/admin/link`).
