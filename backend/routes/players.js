const express = require('express');
const db = require('../db');

const router = express.Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function sendSuccess(res, data) {
  return res.json({ success: true, data });
}

function sendError(res, status, message, details) {
  return res.status(status).json({
    success: false,
    error: { message, details }
  });
}

function validatePayload(body) {
  const firstName = (body.first_name || '').trim();
  const lastName = (body.last_name || '').trim();
  const email = body.email ? body.email.trim() : '';
  const phone = body.phone ? body.phone.trim() : '';

  if (!firstName || !lastName) {
    return { error: 'Le prénom et le nom sont obligatoires.' };
  }

  if (email && !emailRegex.test(email)) {
    return { error: "L'email n'est pas valide." };
  }

  return { firstName, lastName, email, phone };
}

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM players ORDER BY created_at DESC');
    return sendSuccess(res, result.rows);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la récupération des joueurs.', error.message);
  }
});

router.get('/stats', async (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10);
  const offset = Number.parseInt(req.query.offset, 10);
  const query = (req.query.q || '').trim();
  const sort = (req.query.sort || 'lastName').trim();
  const order = req.query.order === 'asc' ? 'asc' : 'desc';

  const whereParams = [];
  let whereClause = '';

  if (query) {
    whereClause = 'WHERE first_name ILIKE $1 OR last_name ILIKE $2 OR email ILIKE $3';
    const like = `%${query}%`;
    whereParams.push(like, like, like);
  }

  const countSql = `SELECT COUNT(*) AS total FROM players ${whereClause}`;
  const playersSql = `
    SELECT *
    FROM players
    ${whereClause}
    ORDER BY last_name ASC, first_name ASC
  `;

  try {
    const countResult = await db.query(countSql, whereParams);
    const totalCount = Number(countResult.rows?.[0]?.total || 0);

    const playersResult = await db.query(playersSql, whereParams);
    const playersRows = playersResult.rows || [];

    if (!playersRows.length) {
      return sendSuccess(res, {
        items: [],
        pagination: {
          limit: Number.isInteger(limit) && limit > 0 ? limit : 0,
          offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
          total: totalCount
        }
      });
    }

    const playerIds = playersRows.map(row => row.id);

    const statsSql = `
      WITH complete_matches AS (
        SELECT DISTINCT match_id
        FROM match_players
        WHERE team IS NOT NULL
      ),
      match_scores AS (
        SELECT
          m.id,
          m.played_at,
          mp.player_id,
          mp.team,
          m.team_a_score,
          m.team_b_score
        FROM matches m
        JOIN complete_matches cm ON cm.match_id = m.id
        JOIN match_players mp ON mp.match_id = m.id
        WHERE m.status = 'played'
      ),
      player_stats AS (
        SELECT
          player_id,
          COUNT(*) AS played_matches,
          SUM(
            CASE
              WHEN team = 'A' AND team_a_score > team_b_score THEN 1
              WHEN team = 'B' AND team_b_score > team_a_score THEN 1
              ELSE 0
            END
          ) AS wins,
          SUM(CASE WHEN team = 'A' THEN team_a_score ELSE team_b_score END) AS total_goals_for
        FROM match_scores
        GROUP BY player_id
      )
      SELECT *
      FROM player_stats
      WHERE player_id = ANY($1)
    `;

    const recentFormSql = `
      WITH complete_matches AS (
        SELECT DISTINCT match_id
        FROM match_players
        WHERE team IS NOT NULL
      ),
      match_scores AS (
        SELECT
          m.id,
          m.played_at,
          mp.player_id,
          mp.team,
          m.team_a_score,
          m.team_b_score
        FROM matches m
        JOIN complete_matches cm ON cm.match_id = m.id
        JOIN match_players mp ON mp.match_id = m.id
        WHERE m.status = 'played'
      ),
      player_results AS (
        SELECT
          player_id,
          id AS match_id,
          played_at,
          CASE
            WHEN team = 'A' AND team_a_score > team_b_score THEN 'W'
            WHEN team = 'B' AND team_b_score > team_a_score THEN 'W'
            WHEN team = 'A' AND team_a_score < team_b_score THEN 'L'
            WHEN team = 'B' AND team_b_score < team_a_score THEN 'L'
            ELSE 'D'
          END AS result
        FROM match_scores
      ),
      ranked AS (
        SELECT
          player_id,
          result,
          played_at,
          ROW_NUMBER() OVER (
            PARTITION BY player_id
            ORDER BY played_at DESC, match_id DESC
          ) AS rn
        FROM player_results
      )
      SELECT player_id, result
      FROM ranked
      WHERE rn <= 5 AND player_id = ANY($1)
      ORDER BY player_id ASC, rn ASC
    `;

    const statsResult = await db.query(statsSql, [playerIds]);
    const formResult = await db.query(recentFormSql, [playerIds]);

    const statsRows = statsResult.rows || [];
    const formRows = formResult.rows || [];

    const statsMap = new Map(statsRows.map(row => [row.player_id, row]));
    const formMap = new Map();

    formRows.forEach(row => {
      if (!formMap.has(row.player_id)) {
        formMap.set(row.player_id, []);
      }
      formMap.get(row.player_id).push(row.result);
    });

    const items = playersRows.map(player => {
      const stats = statsMap.get(player.id) || {};
      const playedMatches = Number(stats.played_matches) || 0;
      const wins = Number(stats.wins) || 0;
      const totalGoalsFor = Number(stats.total_goals_for) || 0;
      const winRate = playedMatches > 0 ? Math.round((wins / playedMatches) * 100) : 0;
      const avgGoalsForPerMatch = playedMatches > 0
        ? Number((totalGoalsFor / playedMatches).toFixed(1))
        : null;

      return {
        ...player,
        stats: {
          playedMatches,
          wins,
          winRate,
          avgGoalsForPerMatch,
          recentForm: formMap.get(player.id) || []
        }
      };
    });

    const getSortValue = (item) => {
      switch (sort) {
        case 'parties':
          return item.stats.playedMatches;
        case 'wins':
          return item.stats.wins;
        case 'winRate':
          return item.stats.winRate;
        case 'avgGoalsForPerMatch':
          return item.stats.avgGoalsForPerMatch;
        case 'lastName':
        default:
          return `${item.last_name || ''}`.toLowerCase();
      }
    };

    const normalizeNumber = (value) => {
      if (value === null || value === undefined) {
        return order === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      return value;
    };

    items.sort((a, b) => {
      const valA = getSortValue(a);
      const valB = getSortValue(b);

      if (typeof valA === 'string' || typeof valB === 'string') {
        const strA = String(valA || '').toLowerCase();
        const strB = String(valB || '').toLowerCase();
        if (strA === strB) return 0;
        return order === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
      }

      const numA = normalizeNumber(valA);
      const numB = normalizeNumber(valB);
      if (numA === numB) return 0;
      return order === 'asc' ? numA - numB : numB - numA;
    });

    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : items.length;
    const pagedItems = items.slice(safeOffset, safeOffset + safeLimit);

    return sendSuccess(res, {
      items: pagedItems,
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        total: totalCount
      }
    });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors du chargement des statistiques joueurs.', error.message);
  }
});

router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    const result = await db.query('SELECT * FROM players WHERE id = $1', [id]);
    const row = result.rows?.[0];
    if (!row) {
      return sendError(res, 404, 'Joueur introuvable.');
    }
    return sendSuccess(res, row);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la récupération du joueur.', error.message);
  }
});

router.post('/', async (req, res) => {
  const { error, firstName, lastName, email, phone } = validatePayload(req.body);
  if (error) {
    return sendError(res, 400, error);
  }

  const sql = `
    INSERT INTO players (first_name, last_name, email, phone)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const params = [firstName, lastName, email || null, phone || null];

  try {
    const result = await db.query(sql, params);
    return sendSuccess(res, result.rows?.[0]);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la création du joueur.', error.message);
  }
});

router.put('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  const { error, firstName, lastName, email, phone } = validatePayload(req.body);
  if (error) {
    return sendError(res, 400, error);
  }

  const sql = `
    UPDATE players
    SET first_name = $1, last_name = $2, email = $3, phone = $4, updated_at = CURRENT_TIMESTAMP
    WHERE id = $5
    RETURNING *
  `;
  const params = [firstName, lastName, email || null, phone || null, id];

  try {
    const result = await db.query(sql, params);
    const row = result.rows?.[0];
    if (!row) {
      return sendError(res, 404, 'Joueur introuvable.');
    }
    return sendSuccess(res, row);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la mise à jour du joueur.', error.message);
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return sendError(res, 400, "L'id est obligatoire.");
  }

  try {
    const result = await db.query('DELETE FROM players WHERE id = $1 RETURNING id', [id]);
    const row = result.rows?.[0];
    if (!row) {
      return sendError(res, 404, 'Joueur introuvable.');
    }
    return sendSuccess(res, { id: row.id });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la suppression du joueur.', error.message);
  }
});

module.exports = router;
