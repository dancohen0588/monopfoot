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

async function getMatchStatus(matchId) {
  const result = await db.query(
    'SELECT id, team_a_score, team_b_score, status FROM matches WHERE id = $1',
    [matchId]
  );
  return result.rows?.[0] || null;
}

async function getRosterPlayerIds(matchId) {
  const result = await db.query(
    'SELECT player_id FROM match_players WHERE match_id = $1',
    [matchId]
  );
  return (result.rows || []).map(row => String(row.player_id));
}

async function countEligibleVoters(matchId) {
  const result = await db.query(
    'SELECT COUNT(*) AS total FROM match_players WHERE match_id = $1',
    [matchId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function countTotalVotes(matchId) {
  const result = await db.query(
    'SELECT COUNT(*) AS total FROM match_mvp_votes WHERE match_id = $1',
    [matchId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

router.post('/matches/:id/mvp/vote', async (req, res) => {
  const matchId = req.params.id;
  const voterId = req.body?.voter_id ? String(req.body.voter_id) : '';
  const votedForId = req.body?.voted_for_id ? String(req.body.voted_for_id) : '';

  if (!matchId) {
    return sendError(res, 400, "L'id du match est obligatoire.");
  }

  if (!voterId || !votedForId) {
    return sendError(res, 400, 'Le votant et le joueur voté sont obligatoires.');
  }

  try {
    const match = await getMatchStatus(matchId);
    if (!match) {
      return sendError(res, 404, 'Match introuvable.');
    }

    if (match.team_a_score === null || match.team_b_score === null || match.status !== 'played') {
      return sendError(res, 400, 'Le match doit être terminé pour voter.');
    }

    const rosterIds = await getRosterPlayerIds(matchId);
    const rosterSet = new Set(rosterIds);
    if (!rosterSet.has(voterId)) {
      return sendError(res, 400, 'Le votant doit appartenir au roster du match.');
    }
    if (!rosterSet.has(votedForId)) {
      return sendError(res, 400, 'Le joueur voté doit appartenir au roster du match.');
    }

    const existingVote = await db.query(
      'SELECT id FROM match_mvp_votes WHERE match_id = $1 AND voter_id = $2',
      [matchId, voterId]
    );
    if (existingVote.rows?.[0]) {
      return sendError(res, 409, 'Ce joueur a déjà voté pour ce match.');
    }

    const insertSql = `
      INSERT INTO match_mvp_votes (match_id, voter_id, voted_for_id)
      VALUES ($1, $2, $3)
      RETURNING id, match_id, voter_id, voted_for_id, created_at
    `;
    const insertResult = await db.query(insertSql, [matchId, voterId, votedForId]);
    return sendSuccess(res, insertResult.rows?.[0]);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de l\'enregistrement du vote.', error.message);
  }
});

router.get('/matches/:id/mvp/status', async (req, res) => {
  const matchId = req.params.id;
  const voterId = req.query.voter_id ? String(req.query.voter_id) : '';

  if (!matchId) {
    return sendError(res, 400, "L'id du match est obligatoire.");
  }

  if (!voterId) {
    return sendError(res, 400, 'Le votant est obligatoire.');
  }

  try {
    const match = await getMatchStatus(matchId);
    if (!match) {
      return sendError(res, 404, 'Match introuvable.');
    }

    const voteResult = await db.query(
      'SELECT voted_for_id, created_at FROM match_mvp_votes WHERE match_id = $1 AND voter_id = $2',
      [matchId, voterId]
    );
    const vote = voteResult.rows?.[0];
    return sendSuccess(res, {
      match_id: matchId,
      voter_id: voterId,
      has_voted: Boolean(vote),
      voted_for_id: vote?.voted_for_id || null,
      created_at: vote?.created_at || null
    });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la vérification du vote.', error.message);
  }
});

router.get('/matches/:id/mvp', async (req, res) => {
  const matchId = req.params.id;
  if (!matchId) {
    return sendError(res, 400, "L'id du match est obligatoire.");
  }

  try {
    const match = await getMatchStatus(matchId);
    if (!match) {
      return sendError(res, 404, 'Match introuvable.');
    }

    const [votesTotal, eligibleVoters] = await Promise.all([
      countTotalVotes(matchId),
      countEligibleVoters(matchId)
    ]);

    const resultsSql = `
      SELECT
        voted_for_id,
        first_name,
        last_name,
        vote_count,
        rank
      FROM match_mvp_results
      WHERE match_id = $1
      ORDER BY rank ASC, vote_count DESC, last_name ASC
    `;
    const resultsResult = await db.query(resultsSql, [matchId]);
    const results = (resultsResult.rows || []).map(row => ({
      player_id: row.voted_for_id,
      first_name: row.first_name,
      last_name: row.last_name,
      votes: Number(row.vote_count) || 0,
      rank: Number(row.rank) || 0
    }));

    const topRank = results.find(row => row.rank === 1);
    const mvpList = results.filter(row => row.rank === 1).map(row => ({
      player_id: row.player_id,
      first_name: row.first_name,
      last_name: row.last_name,
      votes: row.votes
    }));

    return sendSuccess(res, {
      match_id: matchId,
      total_votes: votesTotal,
      eligible_voters: eligibleVoters,
      results: results.map(row => ({
        ...row,
        is_mvp: row.rank === 1
      })),
      mvp: topRank
        ? { player_id: topRank.player_id, first_name: topRank.first_name, last_name: topRank.last_name, votes: topRank.votes }
        : null,
      mvps: mvpList
    });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors du chargement des votes MVP.', error.message);
  }
});

router.delete('/matches/:id/mvp/vote', async (req, res) => {
  const matchId = req.params.id;
  const voterId = req.query.voter_id ? String(req.query.voter_id) : '';

  if (!matchId) {
    return sendError(res, 400, "L'id du match est obligatoire.");
  }

  if (!voterId) {
    return sendError(res, 400, 'Le votant est obligatoire.');
  }

  try {
    const result = await db.query(
      'DELETE FROM match_mvp_votes WHERE match_id = $1 AND voter_id = $2 RETURNING id',
      [matchId, voterId]
    );
    if (!result.rows?.[0]) {
      return sendError(res, 404, 'Vote introuvable.');
    }
    return sendSuccess(res, { match_id: matchId, voter_id: voterId });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors de la suppression du vote.', error.message);
  }
});

router.get('/players/mvp-stats', async (req, res) => {
  try {
    const statsSql = `
      SELECT player_id, first_name, last_name, mvp_count, total_votes_received
      FROM player_mvp_stats
      ORDER BY mvp_count DESC, total_votes_received DESC, last_name ASC
    `;
    const statsResult = await db.query(statsSql);
    const data = (statsResult.rows || []).map(row => ({
      player: { id: row.player_id, first_name: row.first_name, last_name: row.last_name },
      mvp_count: Number(row.mvp_count) || 0,
      total_votes: Number(row.total_votes_received) || 0
    }));
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, 500, 'Erreur lors du chargement des stats MVP.', error.message);
  }
});

module.exports = router;
