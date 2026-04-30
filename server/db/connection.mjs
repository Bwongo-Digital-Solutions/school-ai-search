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
    close: () => pool.end(),
  };
};

export const waitForDatabase = async (database, { attempts = 30, delayMs = 2000 } = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await database.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};
