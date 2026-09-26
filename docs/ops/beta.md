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
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SUPPORT_FOUNDER` | paiements (décision 0011) : clé API Stripe restreinte (`rk_live_…`), secret de signature de l'endpoint webhook (`whsec_…`), identifiant du prix « Soutenir Aurane » (`price_…`, imprimé par `tools/stripe/setup-products.mjs`) ; **tant qu'une des trois manque, les paiements sont coupés** : `/api/pay/*` répond `503 payments_disabled`, `/api/public/config` renvoie `payments.enabled: false` et le client masque le bouton. `STRIPE_API_VERSION` (facultatif) force une version d'API, `2025-03-31.basil` par défaut | vides tant que Managed Payments n'est pas activé ; puis secrets Vaultwarden |
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
confirmation de doctrine (`DOCTRINE_CONFIRM`, **active par défaut** depuis le 26.09.2026 : le joueur valide
en clair ce que son Général fera en son absence ; `DOCTRINE_CONFIRM=0` la coupe ; une doctrine non confirmée
expire après `DOCTRINE_PENDING_TTL_H`, 24 h, et la précédente reste active ; table `doctrine_pending` créée au
démarrage). La liste complète, les valeurs proposées pour la bêta et
la marche à suivre pour vérifier le catalogue d'un fournisseur sont dans
[docs/ai/ARCHITECTURE.md](../ai/ARCHITECTURE.md). Les anciennes `LLM_PRIMARY_*` / `LLM_FALLBACK_*`
restent lues en compatibilité. Métriques : `GET /api/admin/llm/metrics` (jeton admin).

## Paiements : « Soutenir Aurane » (décision 0011)

Stripe **Managed Payments** est le vendeur officiel (*merchant of record*) : il encaisse, applique et reverse la TVA
du pays du client (incluse dans le prix de 5 CHF), émet le reçu et répond au client. Aucune carte ne passe par nous.
Compte Stripe : celui de ninabot Sàrl (CH, lieu d'établissement éligible).

- Catalogue dans le code (`apps/world/src/payments/catalog.ts`), un seul prix de référence en CHF : seul
  `support_founder` (5 CHF, une fois, titre cosmétique de Fondateur, aucun effet sur le jeu) est en vente ;
  `mecene_season` (12 CHF), `eclats_300` (3 CHF, 30 jours), `companion_season` (3 CHF) sont déclarés, pas vendables.
- Les achats appartiennent au **compte** (table `entitlements`, idempotente sur l'identifiant de session Checkout) ;
  un invité doit d'abord protéger sa Colonie (passkey ou e-mail de secours). `packages/sim` ne les voit jamais
  (`packages/sim/test/isolation.test.ts`).
- Routes : `POST /api/pay/checkout` (`{sku}`, session du joueur), `POST /api/pay/webhook` (Stripe, signature sur le
  corps brut, tolérance 5 min), `GET /api/account/entitlements`.
- Un remboursement total (`charge.refunded`) ou un litige perdu (`charge.dispute.closed`, `lost`) retire le titre.
- Paiement reçu pour un compte inconnu : journal `world` (`"scope":"pay"`, `refund by hand`), remboursement manuel
  dans le tableau de bord.

Mise en route (Nick, une fois) :

1. Tableau de bord Stripe → <https://dashboard.stripe.com/settings/managed-payments> : activer Managed Payments et
   accepter ses conditions (d'abord en mode test, puis en production).
2. Clé restreinte (Developers → API keys → Create restricted key), droits : **Checkout Sessions : Write** ; pour le
   script de mise en place, **Products : Write** et **Prices : Write** (clé à part, ou retirés après). Tout le reste à
   None. Webhooks n'a pas besoin de droit : l'endpoint se crée dans le tableau de bord.
3. `STRIPE_SECRET_KEY=rk_… node tools/stripe/setup-products.mjs` → imprime `STRIPE_PRICE_SUPPORT_FOUNDER=price_…`.
4. Webhook (Developers → Webhooks → Add endpoint) : `https://play.playaurane.com/api/pay/webhook`, version d'API
   `2025-03-31.basil` ou plus récente, événements `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` (reçu, ignoré),
   `charge.refunded`, `charge.dispute.closed` ; le secret de signature (`whsec_…`) va dans `STRIPE_WEBHOOK_SECRET`.
5. Les trois valeurs dans Vaultwarden (collection aurane), puis `.env` de la VM, redéploiement. Tester en mode test
   (carte `4242 4242 4242 4242`) avant les clés de production.
