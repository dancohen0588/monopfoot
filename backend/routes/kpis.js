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

router.get('/', async (req, res) => {
  const playersCountSql = 'SELECT COUNT(*) AS total FROM players';

  const playedMatchesSql = `
    SELECT COUNT(*) AS total
    FROM matches m
    WHERE m.status = 'played'
      AND EXISTS (
        SELECT 1
        FROM match_players mp
        WHERE mp.match_id = m.id
          AND mp.team IS NOT NULL
      )
  `;

  const matchesByMonthSql = `
    SELECT
      TO_CHAR(m.played_at, 'YYYY-MM') AS month,
      COUNT(*) AS total_matches
    FROM matches m
    WHERE m.status = 'played'
      AND EXISTS (
        SELECT 1
        FROM match_players mp
        WHERE mp.match_id = m.id
          AND mp.team IS NOT NULL
      )
    GROUP BY TO_CHAR(m.played_at, 'YYYY-MM')
    ORDER BY month ASC
  `;

  const topWinnersSql = `
    WITH complete_matches AS (
      SELECT DISTINCT match_id
      FROM match_players
      WHERE team IS NOT NULL
    ),
    winners AS (
      SELECT
        m.id AS match_id,
        CASE
          WHEN m.team_a_score > m.team_b_score THEN 'A'
          WHEN m.team_b_score > m.team_a_score THEN 'B'
          ELSE 'D'
        END AS winner
      FROM matches m
      JOIN complete_matches cm ON cm.match_id = m.id
      WHERE m.status = 'played'
    ),
    winner_players AS (
      SELECT mp.player_id
      FROM winners w
      JOIN match_players mp ON mp.match_id = w.match_id
      WHERE (w.winner = 'A' AND mp.team = 'A')
         OR (w.winner = 'B' AND mp.team = 'B')
    )
    SELECT
      p.id,
      p.first_name,
      p.last_name,
      COUNT(*) AS wins
    FROM winner_players wp
    JOIN players p ON p.id = wp.player_id
    GROUP BY p.id
    ORDER BY wins DESC, p.last_name ASC
    LIMIT 3
  `;

  const topScorerSql = `
    WITH complete_matches AS (
      SELECT DISTINCT match_id
      FROM match_players
      WHERE team IS NOT NULL
    ),
    match_scores AS (
      SELECT
        m.id,
        mp.player_id,
        mp.team,
        m.team_a_score,
        m.team_b_score
      FROM matches m
      JOIN complete_matches cm ON cm.match_id = m.id
      JOIN match_players mp ON mp.match_id = m.id
      WHERE m.status = 'played'
    ),
    player_goals AS (
      SELECT
        player_id,
        SUM(CASE WHEN team = 'A' THEN team_a_score ELSE team_b_score END) AS goals_for
      FROM match_scores
      GROUP BY player_id
    )
    SELECT
      p.id,
      p.first_name,
      p.last_name,
      pg.goals_for
    FROM player_goals pg
    JOIN players p ON p.id = pg.player_id
    ORDER BY pg.goals_for DESC, p.last_name ASC
    LIMIT 1
  `;

  const totalMvpVotesSql = 'SELECT COUNT(*) AS total FROM match_mvp_votes';

  const mvpLeaderboardSql = `
    SELECT player_id, first_name, last_name, mvp_count, total_votes_received
    FROM player_mvp_stats
    ORDER BY mvp_count DESC, total_votes_received DESC, last_name ASC
    LIMIT 3
  `;

  try {
    const [
      playersCountResult,
      playedMatchesResult,
      matchesByMonthResult,
      topWinnersResult,
      topScorerResult,
      totalMvpVotesResult,
      mvpLeaderboardResult
    ] = await Promise.all([
      db.query(playersCountSql),
      db.query(playedMatchesSql),
      db.query(matchesByMonthSql),
      db.query(topWinnersSql),
      db.query(topScorerSql),
      db.query(totalMvpVotesSql),
      db.query(mvpLeaderboardSql)
    ]);

    const playersCount = Number(playersCountResult.rows?.[0]?.total || 0);
    const playedMatchesCount = Number(playedMatchesResult.rows?.[0]?.total || 0);

    const matchesByMonth = (matchesByMonthResult.rows || []).map(row => ({
      month: row.month,
      label: new Date(`${row.month}-01`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
      count: Number(row.total_matches) || 0
    }));

    const topWinners = (topWinnersResult.rows || []).map(row => ({
      player: { id: row.id, first_name: row.first_name, last_name: row.last_name },
      wins: Number(row.wins) || 0
    }));

    const scorerRow = topScorerResult.rows?.[0];
    const topScorer = scorerRow
      ? {
          player: { id: scorerRow.id, first_name: scorerRow.first_name, last_name: scorerRow.last_name },
          goalsFor: Number(scorerRow.goals_for) || 0
        }
      : null;

    const totalMvpVotes = Number(totalMvpVotesResult.rows?.[0]?.total || 0);
    const mvpLeaderboard = (mvpLeaderboardResult.rows || []).map(row => ({
      player: { id: row.player_id, first_name: row.first_name, last_name: row.last_name },
      mvp_count: Number(row.mvp_count) || 0,
      total_votes: Number(row.total_votes_received) || 0
    }));

    return sendSuccess(res, {
      playersCount,
      playedMatchesCount,
      matchesByMonth,
      topWinners,
      topScorer,
      totalMvpVotes,
      mvpLeaderboard
    });
  } catch (error) {
    return sendError(res, 500, 'Erreur lors du chargement des KPIs.', error.message);
  }
});

module.exports = router;
