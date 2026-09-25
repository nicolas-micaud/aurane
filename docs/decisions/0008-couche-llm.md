# 0008 — La couche LLM des Généraux : un modèle par voix, le moteur qui analyse, une file qui lisse

Date : 25 septembre 2026. Nick, d'après une analyse Claude web : « refondre la couche LLM des Généraux
selon l'architecture ci-dessous ; tu travailles en autonomie ». Livré par la session locale (gmk1) sur la
branche `claude/llm-layer`, sans déploiement.

## Le diagnostic retenu

1. Le repli automatique vers Apertus 70B changeait la personnalité du Général en pleine conversation.
2. Un 24B ne raisonne pas seul sur la topologie du Réseau : il recevait l'état brut et devait déduire.
3. La personnalité tenait dans une fiche courte ; ni exemples, ni mémoire, ni banque de dégradation.
4. Le risque de pointe (connexions après le Tirage, Gazette à la première lecture) était servi en
   synchrone dans la requête, sans file ni lissage. Le Tirage lui-même n'appelait déjà aucun modèle.

## Ce qu'on décide

- **Classes d'usage** : `voice` (dialogue, doctrine, briefing, réactions) sur **un modèle épinglé**, servi
  par une liste ordonnée de fournisseurs interchangeables ; `narrative` (Gazette, mémoires) sur un modèle
  plus gros, configuré à part. Quand tous les fournisseurs d'une classe manquent, **dégradation en
  personnage**, jamais un autre modèle.
- **Le moteur analyse, le Général raconte** : module d'analyse déterministe et testé ; le prompt reçoit ses
  résultats et 3 à 5 options chiffrées ; tout chiffre cité est vérifié.
- **File de jobs à priorités** persistée dans Postgres, échéances sur les requêtes vivantes, jitter sur
  le reste, briefing paresseux mis en cache, Gazette en lot hors pointe, quotas par joueur par heure et
  par jour.
- **Personnalité en données** : fiches JSON FR/EN, exemples en rotation, mémoire structurée (faits du
  journal + formules récentes + saisons), banque de dégradation.
- **Doctrine stricte** : schéma JSON contraint quand le fournisseur le permet, une réparation, validation
  sémantique, une question de clarification, aperçu lisible avant activation (`DOCTRINE_CONFIRM`).
- **Sécurité** : textes tiers clôturés comme données, tests d'injection, secrets par l'environnement.
- **Observabilité** : métriques par classe/fournisseur/tâche, projection de capacité.

Détail : [docs/ai/ARCHITECTURE.md](../ai/ARCHITECTURE.md), plan : [docs/ai/PLAN.md](../ai/PLAN.md),
banc : [docs/ai/persona-report.md](../ai/persona-report.md).

## Ce qui revient à Nick

- **Fournisseurs de la classe `voice`** : Scaleway est en place ; Infomaniak seulement si son catalogue sert
  Mistral Small 3.2 sous un nom à relever (`/models`) ; vLLM auto-hébergé (GPU Exoscale à la demande) à
  provisionner ou non.
- **Modèle de la classe `narrative`** : Apertus 70B (Infomaniak, Suisse) proposé ; ou rester sur Mistral
  Small pour la Gazette tant que le volume est faible.
- **Quotas** : 20 messages par heure et 60 par jour, 12 doctrines et 8 briefings par jour proposés.
- **`DOCTRINE_CONFIRM`** : activer quand la session cloud aura câblé l'écran de confirmation.
- **Mémoires de fin de saison** : contenu à décider avant de les écrire.
