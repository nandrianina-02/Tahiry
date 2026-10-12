# Tahiry — Backend (API questionnaires personnalisables)

API Node.js/Express + MongoDB pour Tahiry : chaque utilisateur crée
un compte, construit ses propres questionnaires (questions ajoutables, modifiables,
supprimables, avec choix du type de réponse et logique conditionnelle), mène ses
entretiens — même hors connexion — et consulte, modifie et exporte ses réponses,
le tout stocké dans MongoDB, isolé par utilisateur.

## Installation

```bash
cd tahiry-backend
npm install
cp .env.example .env
```

Édite `.env` :
- `MONGODB_URI` : ton URI MongoDB Atlas (ou local `mongodb://localhost:27017/tahiry`)
- `JWT_SECRET` : une chaîne aléatoire longue (ex: générée avec `openssl rand -hex 32`)
- `PORT` : 3000 par défaut
- `SMTP_*` : facultatif, pour l'envoi réel des emails de réinitialisation de mot de
  passe (voir section dédiée plus bas). Sans ça, le lien de réinitialisation est
  simplement affiché dans les logs du serveur.

## Lancer en local

```bash
npm start
```

Le frontend (`public/index.html`) est inclus dans le dépôt. Ouvre ensuite `http://localhost:3000` — le frontend et l'API sont servis par le
même serveur (même origine), donc pas de souci de cookies/CORS.

## Déploiement sur Vercel

Ce projet est déjà adapté pour Vercel : `api/index.js` exporte l'app Express comme
fonction serverless, `vercel.json` route `/api/*` vers cette fonction, et
`public/index.html` est servi automatiquement comme fichier statique à la racine.
La connexion MongoDB est mise en cache (`lib/dbConnect.js`) pour être réutilisée
entre les invocations au lieu de se reconnecter à chaque requête.

**Via le site vercel.com (recommandé) :**
1. Pousse ce dossier sur un repo GitHub.
2. Sur [vercel.com](https://vercel.com) : Add New -> Project -> importe le repo.
3. Framework Preset : laisse "Other" (aucun build nécessaire).
4. Dans Settings -> Environment Variables, ajoute :
   - `MONGODB_URI` -> ton URI MongoDB Atlas
   - `JWT_SECRET` -> une chaîne aléatoire longue (`openssl rand -hex 32`)
   - `NODE_ENV` -> `production`
   - (facultatif) `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
     pour l'email de mot de passe oublié
5. Deploy. L'app (front + API) est servie sur une seule URL `https://ton-projet.vercel.app`.

**Via la CLI :**
```bash
npm i -g vercel
cd tahiry-backend
vercel          # suit les invites, puis :
vercel env add MONGODB_URI
vercel env add JWT_SECRET
vercel --prod
```

**Important côté MongoDB Atlas :** dans Network Access, autorise `0.0.0.0/0`
(Vercel utilise des IP dynamiques pour ses fonctions serverless, donc une IP fixe
ne suffit pas).

Comme frontend et API sont sur le même domaine Vercel, les cookies de session
fonctionnent nativement sans configuration CORS supplémentaire.

**Limite connue sur Vercel :** la limitation anti-bruteforce des tentatives de
connexion (voir plus bas) est stockée en mémoire du processus. Sur Vercel, chaque
fonction serverless peut tourner dans un conteneur différent, donc cette protection
est moins efficace qu'sur un serveur classique (Render) où le processus est
persistant. Le verrouillage de compte après échecs répétés (stocké en base de
données, donc fiable partout) reste la protection principale.

## Déploiement sur Render (alternative)

1. Pousse ce dossier sur un repo GitHub (avec `public/index.html` dedans).
2. Sur Render : New -> Web Service -> connecte le repo.
3. Build command : `npm install`
4. Start command : `npm start`
5. Ajoute les variables d'environnement `MONGODB_URI`, `JWT_SECRET`, et
   `NODE_ENV=production` (+ `SMTP_*` si tu veux l'email de mot de passe oublié).
6. Une fois déployé, ton app est accessible directement à l'URL Render fournie.
   (Le code détecte automatiquement s'il tourne en local/Render — `app.listen`
   n'est appelé que hors environnement Vercel.)

## Email pour "mot de passe oublié"

Sans configuration SMTP, la demande de réinitialisation fonctionne quand même :
le lien est simplement écrit dans les logs du serveur (pratique en développement,
mais pas utilisable en production réelle avec de vrais utilisateurs).

Pour l'activer avec Gmail :
1. Active la validation en 2 étapes sur le compte Google à utiliser.
2. Crée un "mot de passe d'application" : https://myaccount.google.com/apppasswords
3. Renseigne dans `.env` (ou les variables d'environnement Vercel/Render) :
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=ton-compte@gmail.com
   SMTP_PASS=le mot de passe d'application généré (pas ton mot de passe Gmail normal)
   SMTP_FROM=ton-compte@gmail.com
   ```

## Sauvegarde de la base de données

Un script de sauvegarde MongoDB (via `mongodump`) est fourni :

```bash
npm run backup
```

Nécessite [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)
installé localement. Sauvegarde dans `./backups/AAAA-MM-JJ_HH-MM-SS/`, avec rotation
automatique (conserve les 14 dernières). À lancer manuellement, ou à planifier via
une tâche cron sur un serveur qui a accès à `MONGODB_URI` :

```bash
# exemple crontab : sauvegarde tous les jours à 2h du matin
0 2 * * * cd /chemin/vers/tahiry-backend && npm run backup >> backup.log 2>&1
```

## Modèle de données

- **User** : email, mot de passe hashé (bcrypt), nom, verrouillage anti-bruteforce,
  token de réinitialisation de mot de passe (hashé, avec expiration)
- **Questionnaire** : appartient à un `owner` (User), a un titre et une liste de
  `questions`. Chaque question a un type (`sel` choix unique, `multi` choix
  multiples, `txt` texte court, `textarea` texte long, `date`, `num` nombre,
  `consent` case RGPD, `scale` échelle numérique, `geo` géolocalisation, `photo`),
  et peut avoir une condition d'affichage (`showIf`) qui la masque tant qu'une
  question précédente n'a pas une certaine valeur.
- **Fiche** : une réponse complète à un questionnaire, liée à l'owner et au
  questionnaire, avec les données dans `data` (clé = `field` de la question).
  Un `clientId` optionnel permet la synchronisation idempotente des réponses
  créées hors-ligne (évite les doublons si la même réponse est renvoyée deux fois).

## Routes API principales

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Créer un compte |
| POST | `/api/auth/login` | Se connecter (cookie JWT httpOnly, anti-bruteforce) |
| POST | `/api/auth/logout` | Se déconnecter |
| GET | `/api/auth/me` | Profil de l'utilisateur connecté |
| POST | `/api/auth/forgot-password` | Demander un lien de réinitialisation |
| POST | `/api/auth/reset-password` | Appliquer un nouveau mot de passe |
| GET | `/api/questionnaires` | Liste de mes questionnaires |
| POST | `/api/questionnaires` | Créer un questionnaire |
| GET | `/api/questionnaires/:id` | Détail (questions incluses) |
| PUT | `/api/questionnaires/:id` | Modifier titre/description/questions |
| POST | `/api/questionnaires/:id/duplicate` | Dupliquer un questionnaire |
| DELETE | `/api/questionnaires/:id` | Supprimer (+ ses réponses) |
| GET | `/api/questionnaires/:id/fiches` | Réponses paginées (`?page=&limit=&q=&sort=`) |
| GET | `/api/questionnaires/:id/fiches/all` | Toutes les réponses (pour export) |
| POST | `/api/questionnaires/:id/fiches` | Enregistrer une réponse (supporte `clientId` pour la sync hors-ligne) |
| PUT | `/api/fiches/:id` | Modifier une réponse existante |
| DELETE | `/api/fiches/:id` | Supprimer une réponse |

Toutes les routes (sauf `/api/auth/register`, `/api/auth/login`,
`/api/auth/forgot-password` et `/api/auth/reset-password`) exigent d'être
connecté ; chaque utilisateur ne voit que ses propres questionnaires et réponses.

## Fonctionnalités côté frontend (index.html)

- **Mode hors-ligne** :
  - **Consultation** : la liste des questionnaires, le contenu d'un questionnaire
    (pour l'Éditeur/Entretien), le Registre et les Statistiques restent consultables
    hors-ligne, à partir des dernières données vues en ligne (mises en cache
    automatiquement dans IndexedDB à chaque chargement réussi). Recherche et
    pagination du Registre se font côté client, donc fonctionnent aussi hors-ligne.
  - **Saisie** : un entretien peut être mené et enregistré entièrement hors-ligne
    (du moment que le questionnaire a déjà été ouvert une fois en ligne) ; la
    réponse est stockée dans IndexedDB puis synchronisée automatiquement dès que
    la connexion revient (bannière visible en haut de l'app avec le nombre de
    réponses en attente, et un panneau dédié pour les rares cas où la
    synchronisation échoue durablement, ex: questionnaire supprimé entre-temps).
  - **Reprise de session hors-ligne** : si l'app est rouverte sans connexion (ex:
    après une longue coupure), la dernière session connue est réutilisée pour ne
    pas bloquer sur l'écran de connexion.
  - **Limite connue** : la création/modification de la *structure* d'un
    questionnaire (Éditeur) nécessite une connexion pour être enregistrée — seule
    la saisie des réponses (entretiens) fonctionne pleinement hors-ligne.
- **Modification de fiche** depuis le Registre.
- **Recherche et pagination** dans le Registre.
- **Logique conditionnelle** : une question peut être masquée tant qu'une réponse
  précédente ne correspond pas à une condition définie dans l'Éditeur.
- **Export CSV, Excel et PDF** du Registre ; export PDF des graphiques Statistiques.
- **Duplication de questionnaire**, **import de questions depuis un CSV**
  (modèle téléchargeable depuis l'Éditeur), **modèles de questions prédéfinis**.
- **Aperçu** du questionnaire sans enregistrer de réponse.
- **Brouillon automatique** de l'éditeur (localStorage), avec proposition de
  restauration si un brouillon plus récent que la dernière sauvegarde est détecté.
- **Mot de passe oublié** depuis l'écran de connexion.
- **Installable comme application** (PWA) : sur Chrome/Edge/Android, un bouton
  "Installer l'application" apparaît automatiquement dans la barre latérale ;
  sur iPhone/iPad (Safari), un bouton équivalent explique la marche à suivre
  (Partager > Sur l'écran d'accueil, faute d'API d'installation sur iOS). Un
  service worker (`public/sw.js`) met en cache la coquille de l'app (HTML,
  manifest, icônes) pour qu'elle se recharge même hors-ligne — les données,
  elles, continuent de passer par IndexedDB (voir mode hors-ligne ci-dessus).

**Note sur la PWA :** le service worker exige HTTPS (ou `localhost`) pour
s'activer — c'est automatique sur Vercel et Render, et déjà le cas en local.
Les icônes sont dans `public/icons/` et le manifeste dans `public/manifest.json`
si tu veux les personnaliser.
#   T a h i r y 
 
 #   T a h i r y 
 
 