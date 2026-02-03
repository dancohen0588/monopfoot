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
     └─ schema.postgres.sql
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
- `POST /api/matches/:id/score`
- `DELETE /api/matches/:id/score`

#### Payload (POST /api/matches)

```json
{
  "played_at": "2026-02-01T19:00:00.000Z",
  "location": "Gymnase Suresnes",
  "teamA": ["uuid1", "uuid2", "uuid3", "uuid4", "uuid5"],
  "teamB": ["uuid6", "uuid7", "uuid8", "uuid9", "uuid10"]
}
```

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
