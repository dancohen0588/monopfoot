const express = require('express');
const db = require('../db');

const router = express.Router();

function sendSuccess(res, data) {
  return res.json({ success: true, data });
}

function sendError(res, status, message, details) {
  return res.status(status).json({
    success: false,
    error: { message, details }
  });
}

function isValidDateTime(value) {
  if (!value || typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function normalizeMatchRow(row) {
  return {
    id: row.id,
    played_at: row.played_at,
    location: row.location,
    status: row.status,
    team_a_score: row.team_a_score,
    team_b_score: row.team_b_score,
    created_at: row.created_at,
    updated_at: row.updated_at,
    teamA: row.teamA || [],
    teamB: row.teamB || []
  };
}

function validateRoster(teamA, teamB) {
  if (!Array.isArray(teamA) || !Array.isArray(teamB)) {
    return { error: 'Les équipes A et B doivent être des listes de joueurs.' };
  }
  if (teamA.length !== 5 || teamB.length !== 5) {
    return { error: 'Chaque équipe doit contenir exactement 5 joueurs.' };
  }

  const allIds = [...teamA, ...teamB].map(id => String(id));
  if (allIds.some(id => !id)) {
    return { error: 'Chaque joueur doit être sélectionné.' };
  }

  const uniqueIds = new Set(allIds);
  if (uniqueIds.size !== 10) {
    return { error: 'Les 10 joueurs doivent être distincts.' };
  }

  return { teamA: teamA.map(id => String(id)), teamB: teamB.map(id => String(id)) };
}

async function getMatchWithTeams(matchId) {
  const matchResult = await db.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  const matchRow = matchResult.rows?.[0];
  if (!matchRow) return null;

  const playersResult = await db.query(
    `SELECT mp.player_id, mp.team, mp.position, p.first_name, p.last_name
     FROM match_players mp
     JOIN players p ON p.id = mp.player_id
     WHERE mp.match_id = $1
     ORDER BY mp.team ASC, mp.position ASC`,
    [matchId]
  );

  const teamA = [];
  const teamB = [];
  playersResult.rows.forEach(row => {
    const payload = {
      id: row.player_id,
      first_name: row.first_name,
      last_name: row.last_name,
      position: row.position
    };
    if (row.team === 'A') teamA.push(payload);
    if (row.team === 'B') teamB.push(payload);
  });

  return normalizeMatchRow({ ...matchRow, teamA, teamB });
}

router.get('/', async (req, res) => {
  try {
    const matchesResult = await db.query(
      `SELECT *
       FROM matches
       ORDER BY played_at DESC, created_at DESC`
    );

    const matchIds = matchesResult.rows.map(row => row.id);
    if (!matchIds.length) {
      return sendSuccess(res, []);
    }

    const playersResult = await db.query(
      `SELECT mp.match_id, mp.player_id, mp.team, mp.position, p.first_name, p.last_name
       FROM match_players mp
       JOIN players p ON p.id = mp.player_id
       WHERE mp.match_id = ANY($1)
       ORDER BY mp.match_id ASC, mp.team ASC, mp.position ASC`,
      [matchIds]
    );

    const map = new Map();
    matchesResult.rows.forEach(row => {
      map.set(row.id, { ...row, teamA: [], teamB: [] });
    });

    playersResult.rows.forEach(row => {
      const entry = map.get(row.match_id);
      if (!entry) return;
      const payload = {
        id: row.player_id,
        first_name: row.first_name,
        last_name: row.last_name,
        position: row.position
      };
      if (row.team === 'A') entry.teamA.push(payload);
      if (row.team === 'B') entry.teamB.push(payload);
    });

    const data = Array.from(map.values()).map(normalizeMatchRow);
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la récupération des matchs.', error.message);
  }
});

router.get('/played', async (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 10;
  const offset = Number.parseInt(req.query.offset, 10) || 0;
  const playerId = req.query.player_id ? String(req.query.player_id) : null;

  if (!Number.isInteger(limit) || limit <= 0) {
    return sendError(res, 400, 'Le paramètre limit doit être un entier positif.');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    return sendError(res, 400, 'Le paramètre offset doit être un entier positif ou nul.');
  }

  let filterClause = '';
  let filterParams = [];
  if (playerId) {
    filterClause = `
      AND EXISTS (
        SELECT 1 FROM match_players mp
        WHERE mp.match_id = m.id AND mp.player_id = $1
      )
    `;
    filterParams = [playerId];
  }

  const countSql = `
    SELECT COUNT(*) AS total
    FROM matches m
    WHERE m.status = 'played'
    ${filterClause}
  `;

  const dataSql = `
    SELECT *
    FROM matches m
    WHERE m.status = 'played'
    ${filterClause}
    ORDER BY m.played_at DESC, m.created_at DESC
    LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
  `;

  try {
    const countResult = await db.query(countSql, filterParams);
    const total = Number(countResult.rows?.[0]?.total || 0);

    const dataParams = [...filterParams, limit, offset];
    const dataResult = await db.query(dataSql, dataParams);
    const rows = dataResult.rows || [];

    const matchIds = rows.map(row => row.id);
    if (!matchIds.length) {
      return sendSuccess(res, {
        items: [],
        pagination: { limit, offset, total }
      });
    }

    const playersResult = await db.query(
      `SELECT mp.match_id, mp.player_id, mp.team, mp.position, p.first_name, p.last_name
       FROM match_players mp
       JOIN players p ON p.id = mp.player_id
       WHERE mp.match_id = ANY($1)
       ORDER BY mp.match_id ASC, mp.team ASC, mp.position ASC`,
      [matchIds]
    );

    const map = new Map();
    rows.forEach(row => {
      map.set(row.id, { ...row, teamA: [], teamB: [] });
    });

    playersResult.rows.forEach(row => {
      const entry = map.get(row.match_id);
      if (!entry) return;
      const payload = {
        id: row.player_id,
        first_name: row.first_name,
        last_name: row.last_name,
        position: row.position
      };
      if (row.team === 'A') entry.teamA.push(payload);
      if (row.team === 'B') entry.teamB.push(payload);
    });

    const items = Array.from(map.values()).map(row => {
      const winner = row.team_a_score === row.team_b_score
        ? 'D'
        : row.team_a_score > row.team_b_score
          ? 'A'
          : 'B';
      return {
        ...normalizeMatchRow(row),
        winner
      };
    });

    return sendSuccess(res, {
      items,
      pagination: { limit, offset, total }
    });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la récupération des matchs joués.', error.message);
  }
});

router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    const match = await getMatchWithTeams(id);
    if (!match) {
      return sendError(res, 404, 'Match introuvable.');
    }
    return sendSuccess(res, match);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la récupération du match.', error.message);
  }
});

router.post('/', async (req, res) => {
  const playedAt = (req.body.played_at || '').trim();
  const location = (req.body.location || '').trim();
  const teamA = req.body.teamA || [];
  const teamB = req.body.teamB || [];

  if (!playedAt || !isValidDateTime(playedAt)) {
    return sendError(res, 400, 'La date/heure est invalide.');
  }

  if (!location) {
    return sendError(res, 400, 'Le lieu est obligatoire.');
  }

  const rosterValidation = validateRoster(teamA, teamB);
  if (rosterValidation.error) {
    return sendError(res, 400, rosterValidation.error);
  }

  try {
    const insertMatchSql = `
      INSERT INTO matches (played_at, location)
      VALUES ($1, $2)
      RETURNING *
    `;
    const matchResult = await db.query(insertMatchSql, [playedAt, location]);
    const match = matchResult.rows?.[0];

    const insertPlayerSql = `
      INSERT INTO match_players (match_id, player_id, team, position)
      VALUES ($1, $2, $3, $4)
    `;

    for (let i = 0; i < rosterValidation.teamA.length; i += 1) {
      await db.query(insertPlayerSql, [match.id, rosterValidation.teamA[i], 'A', i + 1]);
    }
    for (let i = 0; i < rosterValidation.teamB.length; i += 1) {
      await db.query(insertPlayerSql, [match.id, rosterValidation.teamB[i], 'B', i + 1]);
    }

    const fullMatch = await getMatchWithTeams(match.id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la création du match.', error.message);
  }
});

router.put('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  const playedAt = (req.body.played_at || '').trim();
  const location = (req.body.location || '').trim();
  const teamA = req.body.teamA || [];
  const teamB = req.body.teamB || [];

  if (!playedAt || !isValidDateTime(playedAt)) {
    return sendError(res, 400, 'La date/heure est invalide.');
  }

  if (!location) {
    return sendError(res, 400, 'Le lieu est obligatoire.');
  }

  const rosterValidation = validateRoster(teamA, teamB);
  if (rosterValidation.error) {
    return sendError(res, 400, rosterValidation.error);
  }

  try {
    const existingResult = await db.query('SELECT status FROM matches WHERE id = $1', [id]);
    const existing = existingResult.rows?.[0];
    if (!existing) {
      return sendError(res, 404, 'Match introuvable.');
    }
    if (existing.status === 'played') {
      return sendError(res, 400, 'Le roster ne peut plus être modifié une fois le score saisi.');
    }

    const updateSql = `
      UPDATE matches
      SET played_at = $1, location = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    await db.query(updateSql, [playedAt, location, id]);

    await db.query('DELETE FROM match_players WHERE match_id = $1', [id]);

    const insertPlayerSql = `
      INSERT INTO match_players (match_id, player_id, team, position)
      VALUES ($1, $2, $3, $4)
    `;

    for (let i = 0; i < rosterValidation.teamA.length; i += 1) {
      await db.query(insertPlayerSql, [id, rosterValidation.teamA[i], 'A', i + 1]);
    }
    for (let i = 0; i < rosterValidation.teamB.length; i += 1) {
      await db.query(insertPlayerSql, [id, rosterValidation.teamB[i], 'B', i + 1]);
    }

    const fullMatch = await getMatchWithTeams(id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la mise à jour du match.', error.message);
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    const result = await db.query('DELETE FROM matches WHERE id = $1 RETURNING id', [id]);
    const row = result.rows?.[0];
    if (!row) {
      return sendError(res, 404, 'Match introuvable.');
    }
    return sendSuccess(res, { id: row.id });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la suppression du match.', error.message);
  }
});

router.post('/:id/score', async (req, res) => {
  const id = req.params.id;
  const teamAScore = Number(req.body.team_a_score);
  const teamBScore = Number(req.body.team_b_score);

  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  if (!Number.isInteger(teamAScore) || teamAScore < 0 || !Number.isInteger(teamBScore) || teamBScore < 0) {
    return sendError(res, 400, 'Les scores doivent être des entiers positifs.');
  }

  try {
    const existsResult = await db.query('SELECT status FROM matches WHERE id = $1', [id]);
    const exists = existsResult.rows?.[0];
    if (!exists) {
      return sendError(res, 404, 'Match introuvable.');
    }

    const updateSql = `
      UPDATE matches
      SET team_a_score = $1, team_b_score = $2, status = 'played', updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    await db.query(updateSql, [teamAScore, teamBScore, id]);
    const fullMatch = await getMatchWithTeams(id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la mise à jour du score.', error.message);
  }
});

router.delete('/:id/score', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    const existsResult = await db.query('SELECT id FROM matches WHERE id = $1', [id]);
    if (!existsResult.rows?.[0]) {
      return sendError(res, 404, 'Match introuvable.');
    }

    await db.query(
      `UPDATE matches
       SET team_a_score = NULL, team_b_score = NULL, status = 'scheduled', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    const fullMatch = await getMatchWithTeams(id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la réinitialisation du score.', error.message);
  }
});

module.exports = router;
