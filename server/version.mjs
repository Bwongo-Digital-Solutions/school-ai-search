/**
 * Product version / build identity, shared by the document footers and the /api/meta endpoint.
 *
 * The version comes from package.json (single source of truth); the build number and developer
 * contacts come from the deploy environment. Kept in sync with the frontend footer, which reads
 * the same values injected at build time by vite.config.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const readVersion = () => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
};

export const APP_VERSION = readVersion();
export const BUILD_NUMBER = process.env.BUILD_NUMBER || 'dev';
export const DEVELOPER_CONTACTS = process.env.DEVELOPER_CONTACTS || 'e-School · support@e-school.app';
