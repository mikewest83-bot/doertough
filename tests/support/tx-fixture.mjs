import { pool } from '../../server/db.mjs';

// Helper to run a test inside a DB transaction and roll it back afterwards.
// It temporarily replaces pool.query with the client's query so existing
// helpers that use the shared pool participate in the transaction.
export async function withTransaction(fn) {
  if (!pool) throw new Error('database_not_configured');
  const client = await pool.connect();
  const originalPoolQuery = pool.query;
  try {
    // Bind pool.query to the client's query so helpers use the transactional client
    pool.query = client.query.bind(client);
    await client.query('BEGIN');
    const res = await fn();
    await client.query('ROLLBACK');
    return res;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // ignore
    }
    throw err;
  } finally {
    // restore original pool.query and release client
    pool.query = originalPoolQuery;
    client.release();
  }
}
