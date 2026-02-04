# Monop’Foot — Organisateur 5v5

Projet **Node.js / Express / Postgres** avec un front **HTML/CSS/JS vanilla**.

## Arborescence

```
./backend
  ├─ package.json
  ├─ server.js
  ├─ db.js
  └─ routes/
     ├─ players.js
     ├─ matches.js
     └─ kpis.js
  └─ data/
     ├─ schema.postgres.sql
     └─ migrations/
        └─ 20260203_add_reservation_and_optional_team.sql
./frontend
  └─ index.html
```

## Prérequis

- Node.js >= 18
- Base Postgres (Supabase recommandé)

## Installation & lancement

### 1) Backend

```bash
cd backend
npm install
npm start
```

L’API démarre sur `http://localhost:3000`.

Variables d’environnement :

- `DATABASE_URL` : URL Postgres Supabase
- `PORT` : port d’écoute (Render fournit `PORT` automatiquement)
- `CORS_ORIGIN` : domaine du front (ex: `https://monopfoot.onrender.com`). Par défaut `*`.

### 2) Frontend

Ouvrir `frontend/index.html` dans votre navigateur.

Dans `frontend/index.html`, remplacer l’URL Render de l’API :

```js
const API_BASE_URL = (() => {
  const localHosts = ['localhost', '127.0.0.1'];
  return localHosts.includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://YOUR-RENDER-BACKEND.onrender.com';
})();
```

## Base de données (Supabase Postgres)

Dans Supabase > SQL Editor, exécuter :

```sql
-- fichier: backend/data/schema.postgres.sql
```

Puis appliquer la migration :

```sql
-- fichier: backend/data/migrations/20260203_add_reservation_and_optional_team.sql
```

## API REST

Format de réponse :

```json
{
  "success": true,
  "data": {}
}
```

En cas d’erreur :

```json
{
  "success": false,
  "error": { "message": "...", "details": "..." }
}
```

### Players

- `GET /api/players`
- `GET /api/players/:id`
- `POST /api/players`
- `PUT /api/players/:id`
- `DELETE /api/players/:id`
- `GET /api/players/stats?q=&sort=&order=&limit=&offset=`

### Matches

- `GET /api/matches`
- `GET /api/matches/played?limit=10&offset=0&player_id=`
- `GET /api/matches/:id`
- `POST /api/matches`
- `PUT /api/matches/:id`
- `DELETE /api/matches/:id`
- `POST /api/matches/:id/compo`
- `POST /api/matches/:id/score`
- `DELETE /api/matches/:id/score`

#### Payload (POST /api/matches)

```json
{
  "played_at": "2026-02-01T19:00:00.000Z",
  "location": "Gymnase Suresnes",
  "reservation_url": "https://urbansoccer.com/booking/...",
  "players": ["uuid1", "uuid2", "uuid3", "uuid4", "uuid5", "uuid6", "uuid7", "uuid8", "uuid9", "uuid10"]
}
```

`players` est optionnel (0 à 10 joueurs distincts). `reservation_url` est optionnel et peut être vide.

#### Idempotency (POST /api/players, POST /api/matches)

Envoyer un header `X-Idempotency-Key` (UUID). Les requêtes identiques reçues avec la même clé dans un délai de 60s renvoient la première réponse.

#### Payload (POST /api/matches/:id/compo)

```json
{
  "teamA": [
    { "player_id": "uuid1", "position": 1 },
    { "player_id": "uuid2", "position": 2 }
  ],
  "teamB": [
    { "player_id": "uuid3", "position": 1 }
  ]
}
```

`teamA` et `teamB` sont variables (0..N). Au moins 1 joueur doit être assigné au total. Les `player_id` doivent être uniques et appartenir au roster du match. Positions positives et uniques par équipe.

#### Règles score & statistiques

- Un score peut être saisi dès que le roster contient au moins 1 joueur.
- Les KPIs et stats joueurs n’incluent que les matchs joués avec une compo existante (au moins 1 joueur assigné à une équipe).

### KPIs

- `GET /api/kpis`

Retour :

```json
{
  "success": true,
  "data": {
    "playersCount": 12,
    "playedMatchesCount": 4,
    "matchesByMonth": [
      { "month": "2026-02", "label": "févr. 2026", "count": 2 }
    ],
    "topWinners": [{ "player": { "id": "..." }, "wins": 2 }],
    "topScorer": { "player": { "id": "..." }, "goalsFor": 9 }
  }
}
```

## Déploiement Render

### Backend (Web Service)

1. Créer un **Web Service** Render.
2. Root Directory : `backend`.
3. Build Command : `npm install`.
4. Start Command : `npm start`.
5. Ajouter la variable `DATABASE_URL` (Supabase).
6. Ajouter `CORS_ORIGIN` avec le domaine du front.

### Frontend (Static Site)

1. Créer un **Static Site** Render.
2. Root Directory : `frontend`.
3. Build Command : vide.
4. Publish Directory : `.`
5. Remplacer l’URL d’API dans `frontend/index.html` (Render backend).
