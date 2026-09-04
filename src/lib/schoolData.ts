import { supabase, buildApiUrl } from './supabase';

/**
 * Backups, and taking the school's records in and out.
 *
 * Two different things behind one screen, because they answer the same question — "what happens to
 * our data?" — from opposite ends. A backup is for restoring this school. An export is for reading
 * the records somewhere else.
 */

export interface BackupRow {
  id: string;
  filename: string;
  size_bytes: number;
  kind: 'manual' | 'scheduled';
  status: 'running' | 'complete' | 'failed';
  error: string;
  created_by: string;
  created_at: string;
}

export interface BackupSchedule {
  enabled: boolean;
  /** 'HH:MM' on a 24-hour clock, in `timezone`. */
  runAt: string;
  /** An IANA zone name, or '' for the server's own clock. */
  timezone: string;
  keepLast: number;
  lastRunAt: string | null;
  lastError: string;
  /**
   * Whether a scheduler is actually running in the server process. A schedule can be saved on a
   * deployment that never starts one, and saying so beats a switch that looks armed and is not.
   */
  runnerActive: boolean;
}

export interface BackupList {
  backups: BackupRow[];
  /** False when this server cannot take one — an in-memory database, or no postgresql-client. */
  available: boolean;
  directory: string;
  schedule: BackupSchedule;
}

export interface ExportableTable {
  name: string;
  columns: string[];
}

export interface ExportedFile {
  name: string;
  table: string;
  rows: number;
  content: string;
}

export interface ExportResult {
  format: 'csv' | 'json';
  exportedAt: string;
  rowCount: number;
  files: ExportedFile[];
}

export interface ImportCheck {
  dryRun: true;
  summary: { table: string; rows: number }[];
  problems: { table: string; problem: string }[];
  /** Empty until the file is clean; the import will not run without it. */
  token: string;
}

const call = async <T,>(name: string, body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw error;
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
};

export const loadBackups = () => call<BackupList>('backup', { action: 'list' });
export const createBackup = () => call<BackupList>('backup', { action: 'create' });
export const deleteBackup = (id: string) => call<BackupList>('backup', { action: 'delete', id });

export const saveBackupSchedule = (schedule: Pick<BackupSchedule, 'enabled' | 'runAt' | 'timezone' | 'keepLast'>) =>
  call<BackupList>('backup', { action: 'save_schedule', ...schedule });

/** The download goes through a GET so the browser saves a file rather than holding it in memory. */
export const backupDownloadUrl = (id: string) => buildApiUrl(`/api/backups/${id}.dump`);

export const loadExportableTables = () =>
  call<{ tables: ExportableTable[] }>('data', { action: 'list_tables' });

export const exportSchoolData = (tables: string[], format: 'csv' | 'json') =>
  call<ExportResult>('data', { action: 'export', tables, format });

export const checkImport = (data: unknown) =>
  call<ImportCheck>('data', { action: 'check_import', data });

export const runImport = (data: unknown, confirm: string) =>
  call<{ imported: true; rowsWritten: number }>('data', { action: 'import', data, confirm });

export interface UploadedFile {
  name: string;
  content: string;
}

/**
 * The same two steps, for files rather than for an already-parsed object.
 *
 * A file is named for the table it holds — `students.csv` — and CSV and JSON are both read. The
 * server does the parsing: a CSV good enough to open in a spreadsheet and a CSV good enough to
 * write back are the same file, and there is no reason for two parsers to disagree about it.
 */
export const checkFileImport = (files: UploadedFile[]) =>
  call<ImportCheck>('data', { action: 'check_import', files });

export const runFileImport = (files: UploadedFile[], confirm: string) =>
  call<{ imported: true; rowsWritten: number }>('data', { action: 'import', files, confirm });

/**
 * Bring a dump in from elsewhere — an old server, a laptop, a provider's export.
 *
 * Base64 because a `.dump` is binary and this travels as JSON. The server checks it really is a
 * custom-format archive before it joins the list of things that can be restored.
 */
export const uploadBackup = (filename: string, content: string) =>
  call<BackupList>('backup', { action: 'upload', filename, content });

/** Replaces everything currently in the database. The word, not a boolean — see the service. */
export const restoreBackup = (id: string) =>
  call<{ restored: true; filename: string; warnings: string }>('backup', {
    action: 'restore', id, confirm: 'restore',
  });
