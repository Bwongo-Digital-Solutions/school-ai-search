// Vercel serverless entry point for the whole /api surface.
//
// The app's backend is normally one long-lived Node server (server/local-backend.mjs). Its request
// handling is factored into a transport-agnostic `dispatch`, which lets us reuse the exact same
// backend here as a single catch-all Vercel function — every /api/* path routes through this file.
//
// IMPORTANT — data persistence: this uses the in-memory database. On serverless, memory lives only
// for the lifetime of a function instance, so the app always starts from the seeded demo data and
// anything you create is NOT durable across cold starts (and may differ between concurrent
// instances). This is a live DEMO of the UI, not a system of record. For real, persistent data,
// deploy the Node server + PostgreSQL on a host that runs a process (Render, Railway, Fly.io, a
// Docker VPS) — see USER_GUIDE.md / TECHNICAL_OVERVIEW.md.
import { createAppRuntime } from '../server/local-backend.mjs';

// Cache the runtime on the module scope so a warm instance reuses one seeded in-memory database
// across requests (a cold start builds a fresh one).
let runtimePromise = null;
const getRuntime = () => {
  if (!runtimePromise) {
    runtimePromise = createAppRuntime({ useInMemoryDatabase: true });
  }
  return runtimePromise;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tenant');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const runtime = await getRuntime();
    const url = new URL(req.url, 'http://localhost');

    // Vercel parses a JSON body into req.body; fall back to parsing a raw string, else empty.
    let body = {};
    if (req.body && typeof req.body === 'object') body = req.body;
    else if (typeof req.body === 'string' && req.body) {
      try { body = JSON.parse(req.body); } catch { body = {}; }
    }

    const result = await runtime.dispatch({
      method: req.method || 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
      body,
      headers: req.headers,
    });

    if (result.type === 'binary') {
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.status(result.status).send(Buffer.from(result.body));
      return;
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
  }
}
