/**
 * The one thing in this server that happens without anybody asking for it.
 *
 * A school that has to remember to press "Back up now" does not have backups; it has a good
 * intention. So a single timer wakes once a minute, asks each school whether the hour it chose has
 * come round, and takes the day's dump for the ones that say yes.
 *
 * Three decisions worth knowing about:
 *
 *   - It asks "has today's time passed and has today's backup been taken?", never "how long since
 *     the last one?". That is what makes it survive restarts. A container that comes back at 09:00
 *     having missed 02:00 still takes the day's backup instead of waiting until tomorrow, and one
 *     restarted at 01:59 does not skip the day.
 *   - It is off unless BACKUP_SCHEDULER is enabled. A background job that starts itself in every
 *     test run and every CLI script is a job that will eventually dump a database somebody was
 *     using for something else.
 *   - It never overlaps itself. A dump of a large school can take longer than the tick interval,
 *     and two pg_dumps racing onto the same schedule would write two backups and log one.
 */
import { listTenants } from '../db/control.mjs';
import { runScheduledBackup, setSchedulerRunning } from './backup.mjs';

const TICK_MS = 60_000;

/** Which tenant databases to consider. Single-tenant deployments are the one-element case. */
const targetsFor = async ({ database, control, tenants }) => {
  if (!control || !tenants?.enabled) return [{ tenantId: 'default', database }];

  let rows = [];
  try {
    rows = await listTenants(control);
  } catch (error) {
    console.warn('Scheduled backups: could not list tenants —', error.message);
    return [];
  }

  const targets = [];
  for (const row of rows) {
    // Only schools whose subscription is live. A suspended tenant's database is not opened at all
    // by the registry, and dumping a school that has stopped paying is not our call to make.
    if (row.status !== 'active') continue;
    try {
      const opened = await tenants.open(row.subdomain, database);
      if (opened.database) targets.push({ tenantId: opened.tenantId, database: opened.database });
    } catch (error) {
      console.warn(`Scheduled backups: could not open ${row.subdomain} —`, error.message);
    }
  }
  return targets;
};

/**
 * One pass over every school. Exported so a test can drive it directly with an injected clock and
 * pg_dump, rather than waiting a minute for a timer.
 */
export const runBackupSweep = async ({ database, control, tenants, runPgDump, now = new Date() }) => {
  const targets = await targetsFor({ database, control, tenants });
  const taken = [];

  for (const target of targets) {
    try {
      const result = await runScheduledBackup({ ...target, runPgDump, now });
      if (result.ran) {
        taken.push(target.tenantId);
        if (result.error) console.warn(`Scheduled backup for ${target.tenantId} failed:`, result.error);
      }
    } catch (error) {
      // One school's failure must not stop the rest of the sweep.
      console.warn(`Scheduled backup for ${target.tenantId} threw:`, error.message);
    }
  }

  return { checked: targets.length, taken };
};

const schedulerEnabled = () => {
  const raw = String(process.env.BACKUP_SCHEDULER ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
};

/**
 * Start the timer. Returns a stop function, which the runtime calls on close.
 *
 * Returns a no-op stop when the scheduler is switched off, so the caller has nothing to branch on.
 */
export const startBackupScheduler = ({ database, control, tenants, runPgDump, intervalMs = TICK_MS } = {}) => {
  if (!schedulerEnabled()) return () => {};

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBackupSweep({ database, control, tenants, runPgDump });
    } catch (error) {
      console.warn('Scheduled backup sweep failed:', error.message);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  // Belt and braces alongside the runtime's close(): an unreffed timer can never be the reason a
  // process refuses to exit, which is exactly how a leaked interval shows up in `node --test`.
  handle.unref?.();
  setSchedulerRunning(true);

  return () => {
    clearInterval(handle);
    setSchedulerRunning(false);
  };
};
