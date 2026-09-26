# Bêta fermée : variables et procédure

Décidé le 24.09.2026. Une saison courte (7 jours) sur playaurane.com, 20 à 30 joueurs invités.

## Variables d'environnement du world server

| Variable | Rôle | Valeur bêta |
|---|---|---|
| `REQUIRE_INVITE` | une nouvelle Colonie exige un code d'invitation | `1` |
| `INVITE_CODES` | codes d'amorçage, séparés par des virgules, utilisables une fois chacun | quelques codes pour les premiers testeurs, le reste par l'admin |
| `ADMIN_TOKEN` | jeton des routes `/api/admin/*` (en-tête `x-admin-token`) ; absent = routes désactivées | secret Vaultwarden, 32 octets aléatoires |
| `AUTH_SECRET` | signe les liens d'appareil (`/#join=…`, 24 h) ; absent = aléatoire par processus, les liens meurent au redémarrage | secret Vaultwarden, 32 octets aléatoires |
| `PUBLIC_ORIGIN` | origine des liens d'appareil et des cérémonies passkey | `https://play.playaurane.com` |
| `RP_ID` | identifiant WebAuthn (décision 0010) ; absent = domaine enregistrable de `PUBLIC_ORIGIN` (`playaurane.com`) | vide |
| `RP_ORIGINS` | origines supplémentaires acceptées pour les passkeys (préproduction), séparées par des virgules | vide |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | expéditeur des codes à six chiffres (décision 0010, lot C) ; 465 = TLS implicite, sinon STARTTLS exigé ; **tant qu'une variable manque, le code est écrit dans les logs de `world`** (`[mail] no SMTP configured; to=…`), ce qui suffit en bêta fermée pour dépanner un joueur à la main | vides (mode logs) ; port `587` |
| `SEASON_SEED` | graine de la saison ; changer la graine (ou le rayon) = nouvelle saison : le monde précédent est archivé au démarrage (`world_snapshots.season:<graine>-<temps>` en Postgres, `world-<…>.json` en fichier), une galaxie neuve est créée | `beta-2` (depuis le 25.09) |
| `GALAXY_RADIUS` | rayon de la galaxie en secteurs ; 6 = 127 secteurs, dense pour 20 à 40 Colonies ; 12 = 200 à 500 Colonies | `6` (depuis le 25.09, décision 0005 § 4.1) |
| `SEASON_DAYS` | durée de la saison | `7` |

Les secrets vivent dans Vaultwarden, puis dans l'env de la VM ; jamais dans le dépôt.

## Invitations

```
curl -X POST https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"count": 10, "note": "vague 1"}'
curl https://play.playaurane.com/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN"
```

Un code a la forme `AUR-XXXXXXXX` (alphabet sans 0/O/1/I), insensible à la casse, à usage unique **par saison** : un code
dépensé sur une Colonie d'une saison terminée redevient utilisable. Les jetons d'appareil d'une saison passée sont refusés ;
le client revient à l'écran d'entrée.

## Comptes

Pas d'e-mail ni de mot de passe en bêta fermée : le jeton d'appareil est le compte. Pour jouer depuis
un second appareil, « Lier un autre appareil » dans le panneau du Général donne un lien valable 24 h
qui ouvre la même Colonie ; la page d'accueil accepte aussi ce lien collé. Un joueur qui perd tous ses
appareils demande un nouveau lien à l'admin (à ajouter si le besoin apparaît : `/api/admin/link`).

## Installer Aurane sur mobile (PWA)

Le client est une application web installable : même code, même serveur, icône sur l'écran d'accueil,
plein écran sans barre d'adresse, mises à jour automatiques (bandeau « Nouvelle version » quand une
livraison arrive). Consignes pour les testeurs :

- **Android (Chrome)** : ouvrir `https://play.playaurane.com`, toucher « Installer l'application » sur
  l'écran d'entrée (ou le menu ⋮ → « Installer l'application »).
- **iPhone / iPad (Safari)** : ouvrir l'adresse dans Safari, bouton Partager, puis « Sur l'écran
  d'accueil ». L'écran d'entrée le rappelle. Les autres navigateurs iOS ne permettent pas l'installation.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Limites face à une application native, à garder pour le portage iOS/Android : pas de notifications
push sur iPhone tant que l'app n'est pas installée (et seulement depuis iOS 16.4), pas de présence sur
les stores, stockage hors ligne limité à la coquille de l'app (la partie exige le réseau).

## Généraux et modèles (décision 0008)

La couche LLM se configure par classe et par fournisseur (`LLM_VOICE_*`, `LLM_NARRATIVE_*`,
`LLM_PROVIDER_<NOM>_*`), avec quotas par joueur (`LLM_QUOTA_*`), échéances des requêtes vivantes
(`LLM_TALK_DEADLINE_MS`, `LLM_BRIEFING_DEADLINE_MS`), lissage de la Gazette (`LLM_GAZETTE_SPREAD_MIN`) et
confirmation de doctrine (`DOCTRINE_CONFIRM`). La liste complète, les valeurs proposées pour la bêta et
la marche à suivre pour vérifier le catalogue d'un fournisseur sont dans
[docs/ai/ARCHITECTURE.md](../ai/ARCHITECTURE.md). Les anciennes `LLM_PRIMARY_*` / `LLM_FALLBACK_*`
restent lues en compatibilité. Métriques : `GET /api/admin/llm/metrics` (jeton admin).
