import pg from 'pg';
import { newDb } from 'pg-mem';

const { Pool, types } = pg;

const NUMERIC_OID = 1700;
const BIGINT_OID = 20;

types.setTypeParser(NUMERIC_OID, (value) => (value === null ? null : Number(value)));
types.setTypeParser(BIGINT_OID, (value) => (value === null ? null : Number(value)));

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://schoolapp:schoolapp@127.0.0.1:5432/school_ai_search';

const getSslConfig = () => {
  if (process.env.DATABASE_SSL === 'true') {
    return {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  return undefined;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createDatabaseConnection = ({
  connectionString = DEFAULT_DATABASE_URL,
  useInMemoryDatabase = false,
} = {}) => {
  if (useInMemoryDatabase) {
    const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
    const memoryPg = memoryDb.adapters.createPg();
    const pool = new memoryPg.Pool();

    return {
      kind: 'memory',
      pool,
      query: (text, params) => pool.query(text, params),
      // pg-mem accepts BEGIN/COMMIT/ROLLBACK but treats all three as no-ops: a rolled-back
      // INSERT still persists. Run the unit of work directly rather than issuing statements
      // that imply a rollback which will never happen. Atomicity is a production guarantee
      // only, so tests must never assert rollback behaviour.
      transaction: async (run) => run({ query: (text, params) => pool.query(text, params) }),
      close: () => pool.end(),
    };
  }

  const pool = new Pool({
    connectionString,
    ssl: getSslConfig(),
    max: Number(process.env.DATABASE_POOL_SIZE || 10),
  });

  return {
    kind: 'postgres',
    pool,
    query: (text, params) => pool.query(text, params),
    transaction: async (run) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The connection is already gone; the server aborts the transaction for us.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
};

// Postgres reports a unique-constraint breach as 23505, and pg-mem sets the same code.
export const UNIQUE_VIOLATION = '23505';

/**
 * Runs a unit of work atomically, retrying the whole thing when a document number collides.
 *
 * Invoice and receipt numbers are allocated by reading the current maximum, so two concurrent
 * callers can pick the same one. The loser trips the UNIQUE constraint, and retrying has to
 * restart the transaction: once Postgres aborts it, every later statement on that connection
 * fails, so catching the collision inside the callback and re-inserting cannot work.
 *
 * Every statement in `run` must go through the supplied executor. A call to database.query()
 * inside the callback runs on a different connection and escapes the transaction entirely.
 */
export const withTransaction = async (database, run, { attempts = 3 } = {}) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.transaction(run);
    } catch (error) {
      if (error?.code !== UNIQUE_VIOLATION || attempt >= attempts) throw error;
    }
  }
};

export const waitForDatabase = async (
  database,
  { attempts = Number(process.env.DATABASE_WAIT_ATTEMPTS || 30), delayMs = 2000 } = {},
) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await database.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // Compose brings the app up before the database is ready, so retrying is normal there.
        // Say so once, otherwise a missing database looks like a silent hang.
        if (attempt === 1) {
          console.log(`Waiting for the database (up to ${attempts * delayMs / 1000}s)...`);
        }
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};
