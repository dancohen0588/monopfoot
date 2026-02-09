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
  const teamA = row.teamA || [];
  const teamB = row.teamB || [];
  const roster = row.roster || [];
  const compoReady = (teamA.length + teamB.length) > 0;

  return {
    id: row.id,
    played_at: row.played_at,
    location: row.location,
    reservation_url: row.reservation_url || null,
    status: row.status,
    team_a_score: row.team_a_score,
    team_b_score: row.team_b_score,
    created_at: row.created_at,
    updated_at: row.updated_at,
    roster,
    teamA,
    teamB,
    compo_ready: compoReady
  };
}

function validatePlayersRoster(players) {
  if (players === undefined || players === null) {
    return { players: [] };
  }
  if (!Array.isArray(players)) {
    return { error: 'La liste des joueurs doit être un tableau.' };
  }
  if (players.length > 10) {
    return { error: 'Le match ne peut pas contenir plus de 10 joueurs.' };
  }

  const allIds = players.map(id => String(id));
  if (allIds.some(id => !id)) {
    return { error: 'Chaque joueur doit être sélectionné.' };
  }

  const uniqueIds = new Set(allIds);
  if (uniqueIds.size !== allIds.length) {
    return { error: 'Les joueurs doivent être distincts.' };
  }

  return { players: allIds };
}

function validateCompoPayload(teamA, teamB) {
  if (!Array.isArray(teamA) || !Array.isArray(teamB)) {
    return { error: 'Les équipes A et B doivent être des listes de joueurs.' };
  }
  if (teamA.length + teamB.length < 1) {
    return { error: 'La composition doit contenir au moins un joueur.' };
  }

  const normalizeEntry = (entry) => ({
    player_id: entry?.player_id ? String(entry.player_id) : '',
    position: Number(entry?.position)
  });

  const teamAEntries = teamA.map(normalizeEntry);
  const teamBEntries = teamB.map(normalizeEntry);
  const allEntries = [...teamAEntries, ...teamBEntries];

  if (allEntries.some(entry => !entry.player_id)) {
    return { error: 'Chaque joueur doit être sélectionné.' };
  }

  const allIds = allEntries.map(entry => entry.player_id);
  if (new Set(allIds).size !== allIds.length) {
    return { error: 'Les joueurs doivent être distincts.' };
  }

  const validatePositions = (entries, teamLabel) => {
    const positions = entries.map(entry => entry.position);
    if (positions.some(pos => !Number.isInteger(pos) || pos < 1)) {
      return `Les positions de l'équipe ${teamLabel} doivent être des entiers positifs.`;
    }
    if (new Set(positions).size !== positions.length) {
      return `Les positions de l'équipe ${teamLabel} doivent être uniques.`;
    }
    return null;
  };

  const teamAError = validatePositions(teamAEntries, 'A');
  if (teamAError) return { error: teamAError };
  const teamBError = validatePositions(teamBEntries, 'B');
  if (teamBError) return { error: teamBError };

  return { teamA: teamAEntries, teamB: teamBEntries };
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
     ORDER BY mp.team ASC NULLS LAST, mp.position ASC NULLS LAST`,
    [matchId]
  );

  const roster = [];
  const teamA = [];
  const teamB = [];
  playersResult.rows.forEach(row => {
    const payload = {
      id: row.player_id,
      first_name: row.first_name,
      last_name: row.last_name,
      position: row.position
    };
    roster.push(payload);
    if (row.team === 'A') teamA.push(payload);
    if (row.team === 'B') teamB.push(payload);
  });

  return normalizeMatchRow({ ...matchRow, roster, teamA, teamB });
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
       ORDER BY mp.match_id ASC, mp.team ASC NULLS LAST, mp.position ASC NULLS LAST`,
      [matchIds]
    );

    const map = new Map();
    matchesResult.rows.forEach(row => {
      map.set(row.id, { ...row, roster: [], teamA: [], teamB: [] });
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
      entry.roster.push(payload);
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
       ORDER BY mp.match_id ASC, mp.team ASC NULLS LAST, mp.position ASC NULLS LAST`,
      [matchIds]
    );

    const map = new Map();
    rows.forEach(row => {
      map.set(row.id, { ...row, roster: [], teamA: [], teamB: [] });
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
      entry.roster.push(payload);
      if (row.team === 'A') entry.teamA.push(payload);
      if (row.team === 'B') entry.teamB.push(payload);
    });

    const items = Array.from(map.values()).map(row => {
      const normalized = normalizeMatchRow(row);
      const hasCompo = (normalized.teamA.length + normalized.teamB.length) > 0;
      const winner = !hasCompo
        ? 'UNKNOWN'
        : row.team_a_score === row.team_b_score
          ? 'D'
          : row.team_a_score > row.team_b_score
            ? 'A'
            : 'B';
      return {
        ...normalized,
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
  const reservationUrl = (req.body.reservation_url || '').trim();
  const players = req.body.players;

  if (!playedAt || !isValidDateTime(playedAt)) {
    return sendError(res, 400, 'La date/heure est invalide.');
  }

  if (!location) {
    return sendError(res, 400, 'Le lieu est obligatoire.');
  }

  const rosterValidation = validatePlayersRoster(players);
  if (rosterValidation.error) {
    return sendError(res, 400, rosterValidation.error);
  }

  try {
    await db.query('BEGIN');
    const insertMatchSql = `
      INSERT INTO matches (played_at, location, reservation_url)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const matchResult = await db.query(insertMatchSql, [playedAt, location, reservationUrl || null]);
    const match = matchResult.rows?.[0];

    const insertPlayerSql = `
      INSERT INTO match_players (match_id, player_id, team, position)
      VALUES ($1, $2, $3, $4)
    `;

    for (let i = 0; i < rosterValidation.players.length; i += 1) {
      await db.query(insertPlayerSql, [match.id, rosterValidation.players[i], null, null]);
    }

    await db.query('COMMIT');

    const fullMatch = await getMatchWithTeams(match.id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    await db.query('ROLLBACK');
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
  const reservationUrl = (req.body.reservation_url || '').trim();
  const hasPlayersPayload = Object.prototype.hasOwnProperty.call(req.body, 'players');
  const players = req.body.players;
  const parsedPlayedAt = playedAt ? new Date(playedAt) : null;
  console.log('[matches.put] payload', {
    id,
    playedAt,
    playedAtIso: parsedPlayedAt && !Number.isNaN(parsedPlayedAt.getTime()) ? parsedPlayedAt.toISOString() : null,
    playedAtLocal: parsedPlayedAt && !Number.isNaN(parsedPlayedAt.getTime()) ? parsedPlayedAt.toString() : null,
    location,
    reservationUrl: reservationUrl || null,
    hasPlayersPayload,
    playersCount: Array.isArray(players) ? players.length : null,
    playersType: Array.isArray(players) ? 'array' : typeof players
  });

  if (!playedAt || !isValidDateTime(playedAt)) {
    return sendError(res, 400, 'La date/heure est invalide.');
  }

  if (!location) {
    return sendError(res, 400, 'Le lieu est obligatoire.');
  }

  let rosterValidation = { players: [] };
  if (hasPlayersPayload) {
    rosterValidation = validatePlayersRoster(players);
    if (rosterValidation.error) {
      return sendError(res, 400, rosterValidation.error);
    }
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

    await db.query('BEGIN');
    const updateSql = `
      UPDATE matches
      SET played_at = $1, location = $2, reservation_url = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    await db.query(updateSql, [playedAt, location, reservationUrl || null, id]);

    if (hasPlayersPayload) {
      const existingPlayersResult = await db.query(
        'SELECT player_id, team, position FROM match_players WHERE match_id = $1',
        [id]
      );
      const existingRows = existingPlayersResult.rows || [];
      const existingIds = new Set(existingRows.map(row => String(row.player_id)));
      const incomingIds = new Set(rosterValidation.players);

      const toDelete = [...existingIds].filter(playerId => !incomingIds.has(playerId));
      const toInsert = rosterValidation.players.filter(playerId => !existingIds.has(playerId));

      console.log('[matches.put] roster diff', {
        id,
        incomingCount: rosterValidation.players.length,
        existingCount: existingIds.size,
        toDeleteCount: toDelete.length,
        toInsertCount: toInsert.length
      });

      if (toDelete.length) {
        await db.query(
          'DELETE FROM match_players WHERE match_id = $1 AND player_id = ANY($2)',
          [id, toDelete]
        );
      }

      const insertPlayerSql = `
        INSERT INTO match_players (match_id, player_id, team, position)
        VALUES ($1, $2, $3, $4)
      `;
      for (let i = 0; i < toInsert.length; i += 1) {
        await db.query(insertPlayerSql, [id, toInsert[i], null, null]);
      }
    }

    await db.query('COMMIT');

    const fullMatch = await getMatchWithTeams(id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    await db.query('ROLLBACK');
    return sendError(res, 500, 'Erreur lors de la mise à jour du match.', error.message);
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    await db.query('DELETE FROM match_players WHERE match_id = $1', [id]);
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

    const rosterResult = await db.query(
      'SELECT COUNT(*) AS total FROM match_players WHERE match_id = $1',
      [id]
    );
    const totalPlayers = Number(rosterResult.rows?.[0]?.total || 0);
    if (totalPlayers < 1) {
      return sendError(res, 400, 'Le score ne peut pas être saisi sans joueur dans le roster.');
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

router.post('/:id/compo', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  const validation = validateCompoPayload(req.body.teamA || [], req.body.teamB || []);
  if (validation.error) {
    return sendError(res, 400, validation.error);
  }

  try {
    const rosterResult = await db.query(
      'SELECT player_id FROM match_players WHERE match_id = $1',
      [id]
    );
    const rosterIds = (rosterResult.rows || []).map(row => String(row.player_id));

    const rosterSet = new Set(rosterIds);
    const allIncoming = [...validation.teamA, ...validation.teamB].map(entry => entry.player_id);
    if (new Set(allIncoming).size !== allIncoming.length) {
      return sendError(res, 400, 'Les joueurs doivent être distincts.' );
    }
    for (const playerId of allIncoming) {
      if (!rosterSet.has(playerId)) {
        return sendError(res, 400, 'La composition doit correspondre au roster du match.');
      }
    }

    await db.query('BEGIN');
    await db.query(
      'UPDATE match_players SET team = NULL, position = NULL WHERE match_id = $1',
      [id]
    );

    const updateSql = `
      UPDATE match_players
      SET team = $1, position = $2
      WHERE match_id = $3 AND player_id = $4
    `;

    for (const entry of validation.teamA) {
      await db.query(updateSql, ['A', entry.position, id, entry.player_id]);
    }
    for (const entry of validation.teamB) {
      await db.query(updateSql, ['B', entry.position, id, entry.player_id]);
    }

    await db.query('COMMIT');

    const fullMatch = await getMatchWithTeams(id);
    return sendSuccess(res, fullMatch);
  } catch (error) {
    await db.query('ROLLBACK');
    return sendError(res, 500, 'Erreur lors de l\'enregistrement de la composition.', error.message);
  }
});

module.exports = router;
