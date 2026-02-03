const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL manquant dans l\'environnement.');
} else {
  try {
    const parsed = new URL(connectionString);
    const safeUser = parsed.username || 'unknown';
    const safeHost = parsed.hostname || 'unknown';
    const safePort = parsed.port || '5432';
    const safeDb = parsed.pathname?.replace('/', '') || 'unknown';
    console.log(`DB target -> user=${safeUser} host=${safeHost} port=${safePort} db=${safeDb}`);
  } catch (error) {
    console.error('DATABASE_URL invalide (parse URL).');
  }
}

const pool = new Pool({
  connectionString
});

module.exports = {
  query: (text, params) => pool.query(text, params)
};
