import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  Tabs,
  Tag,
} from '@carbon/react';
import {
  Archive,
  DataBase,
  Document,
  Download,
  TrashCan,
  Upload,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { downloadFromUrl } from '@/lib/download';
import { formatDateTime } from '@/lib/format';
import {
  backupDownloadUrl,
  checkImport,
  createBackup,
  deleteBackup,
  exportSchoolData,
  loadBackups,
  loadExportableTables,
  runImport,
  type BackupList,
  type ExportableTable,
  type ImportCheck,
} from '@/lib/schoolData';
import { AccessDenied, CardHeader, EmptyState, PageHeader, WidgetCard } from '@/components/common';
import styles from './school-data.module.scss';

/**
 * The school's records as a whole: backups, and taking the data in and out.
 *
 * One screen, because they are the same worry from two directions — "can we get this back?" and
 * "can we get this out?" — and a school asks both of a new system in the same conversation.
 *
 * Restricted to the roles that answer for the institution. A backup is every student record in one
 * file, so this is not a teacher's screen even though a teacher may read any one of those records.
 */

const SECTIONS = [
  { key: 'backups', label: 'Backups', icon: Archive },
  { key: 'export', label: 'Export', icon: Download },
  { key: 'import', label: 'Import', icon: Upload },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const readableSize = (bytes: number) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const SchoolDataWorkspace: React.FC = () => {
  const { isPrivileged } = useAuth();
  const { notify, confirm } = useNotifications();

  const [section, setSection] = useState<SectionKey>('backups');
  const [backups, setBackups] = useState<BackupList | null>(null);
  const [tables, setTables] = useState<ExportableTable[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [backupList, tableList] = await Promise.all([loadBackups(), loadExportableTables()]);
      setBackups(backupList);
      setTables(tableList.tables);
    } catch (err) {
      notify.error('Could not load this screen', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    if (isPrivileged) void refresh();
  }, [isPrivileged, refresh]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      notify.error(`${label} failed`, err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (!isPrivileged) {
    return (
      <AccessDenied
        title="Not available to your role"
        message="A backup or an export is every student record in one file, so this screen is for the head teacher, the administrator, and whoever keeps the books."
      />
    );
  }

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setPayload(parsed);
        setCheck(await checkImport(parsed));
      } catch (err) {
        setPayload(null);
        setCheck(null);
        notify.error('That file could not be read', err instanceof Error ? err.message : undefined);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={styles.screen}>
      <PageHeader title="School data" illustration={<DataBase size={32} />} />

      <div className={styles.controls}>
        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex((entry) => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="School data sections" contained>
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <Tab key={key} renderIcon={Icon}>
                  {label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </div>
      </div>

      <div className={styles.body}>
        {section === 'backups' && (
          <WidgetCard>
            <CardHeader title="Backups">
              <Button
                kind="primary"
                size="sm"
                renderIcon={Archive}
                disabled={Boolean(busy) || !backups?.available}
                onClick={() =>
                  run('Taking a backup', async () => {
                    setBackups(await createBackup());
                    notify.success('Backup taken', 'It is listed below and can be downloaded.');
                  })
                }
              >
                {busy === 'Taking a backup' ? 'Taking…' : 'Back up now'}
              </Button>
            </CardHeader>

            <div className={styles.section}>
              {backups && !backups.available && (
                <InlineNotification
                  kind="info"
                  title="Backups cannot be taken on this server"
                  subtitle="It is running on an in-memory database, or without the PostgreSQL client tools installed."
                  lowContrast
                  hideCloseButton
                />
              )}
              <p className={styles.note}>
                A backup is a complete copy of this school — every student record, every payment, and
                the accounts staff sign in with. Downloading one takes all of that off the server, so
                keep it somewhere you would keep the paper register.
              </p>
            </div>

            {!backups ? (
              <div className={styles.loading}>
                <InlineLoading description="Loading…" />
              </div>
            ) : backups.backups.length === 0 ? (
              <EmptyState
                headerTitle="Backups"
                displayText="backups yet"
                helperText="Take one before a term rolls over, or before importing anything."
              />
            ) : (
              backups.backups.map((backup) => (
                <div key={backup.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.filename}>{backup.filename}</p>
                    <p className={styles.meta}>
                      {formatDateTime(backup.created_at)} · {readableSize(backup.size_bytes)}
                      {backup.created_by ? ` · ${backup.created_by}` : ' · automatic'}
                    </p>
                  </div>
                  <div className={styles.actions}>
                    {backup.status !== 'complete' && (
                      <Tag type={backup.status === 'failed' ? 'red' : 'cool-gray'} size="sm">
                        {backup.status === 'failed' ? backup.error || 'Failed' : 'In progress'}
                      </Tag>
                    )}
                    {backup.status === 'complete' && (
                      <Button
                        kind="ghost"
                        size="sm"
                        renderIcon={Download}
                        onClick={() =>
                          run('Downloading the backup', () =>
                            downloadFromUrl(backupDownloadUrl(backup.id), backup.filename),
                          )
                        }
                      >
                        Download
                      </Button>
                    )}
                    <Button
                      hasIconOnly
                      kind="danger--ghost"
                      size="sm"
                      renderIcon={TrashCan}
                      iconDescription={`Delete ${backup.filename}`}
                      tooltipPosition="left"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete this backup?',
                          message: `${backup.filename} is removed from the server permanently. Any copy you have already downloaded is unaffected.`,
                          confirmLabel: 'Delete',
                          danger: true,
                        });
                        if (ok) await run('Deleting the backup', async () => setBackups(await deleteBackup(backup.id)));
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </WidgetCard>
        )}

        {section === 'export' && (
          <WidgetCard>
            <CardHeader title="Export">
              <span className={styles.note}>
                {chosen.length ? `${chosen.length} selected` : 'everything'}
              </span>
            </CardHeader>
            <div className={styles.section}>
              <p className={styles.blurb}>
                A readable copy, for a spreadsheet or another system. Credentials are never included —
                no password hashes, and no keys for the services this school is connected to.
              </p>

              <div className={styles.tableGrid}>
                {tables.map((table) => (
                  <Checkbox
                    key={table.name}
                    id={`table-${table.name}`}
                    labelText={table.name.replace(/_/g, ' ')}
                    checked={chosen.includes(table.name)}
                    onChange={(_event, { checked }) =>
                      setChosen((current) =>
                        checked ? [...current, table.name] : current.filter((n) => n !== table.name),
                      )
                    }
                  />
                ))}
              </div>

              <div className={styles.actions}>
                {(['csv', 'json'] as const).map((format) => (
                  <Button
                    key={format}
                    kind={format === 'csv' ? 'primary' : 'tertiary'}
                    size="md"
                    renderIcon={Document}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run('Exporting', async () => {
                        const result = await exportSchoolData(chosen, format);
                        // Each table comes back as its own file, which is what a spreadsheet wants.
                        for (const file of result.files) {
                          const blob = new Blob([file.content], {
                            type: format === 'csv' ? 'text/csv' : 'application/json',
                          });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = file.name;
                          link.click();
                          URL.revokeObjectURL(url);
                        }
                        notify.success(
                          `Exported ${result.rowCount} rows`,
                          `${result.files.length} file(s) downloaded.`,
                        );
                      })
                    }
                  >
                    {format === 'csv' ? 'Download CSV' : 'Download JSON'}
                  </Button>
                ))}
                {chosen.length > 0 && (
                  <Button kind="ghost" size="md" onClick={() => setChosen([])}>
                    Clear selection
                  </Button>
                )}
              </div>
            </div>
          </WidgetCard>
        )}

        {section === 'import' && (
          <WidgetCard>
            <CardHeader title="Import" />
            <div className={styles.section}>
              <p className={styles.blurb}>
                Reads a JSON export back in. A row that is already here is updated rather than
                duplicated, matched on its id.
              </p>
              <InlineNotification
                kind="warning"
                title="Take a backup first"
                subtitle="An import writes over existing records. It is the one thing on this screen that cannot be undone."
                lowContrast
                hideCloseButton
              />

              <div className={styles.dropZone}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  onChange={onFile}
                  hidden
                />
                <Button kind="tertiary" renderIcon={Upload} onClick={() => fileInput.current?.click()}>
                  Choose a JSON export
                </Button>
              </div>

              {check && (
                <>
                  {check.summary.length > 0 && (
                    <p className={styles.blurb}>
                      {check.summary.map((entry) => `${entry.rows} × ${entry.table}`).join(' · ')}
                    </p>
                  )}
                  {check.problems.length > 0 && (
                    <ul className={styles.problems}>
                      {check.problems.map((problem) => (
                        <li key={`${problem.table}-${problem.problem}`}>
                          {problem.table}: {problem.problem}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className={styles.actions}>
                    <Button
                      kind="danger"
                      disabled={!check.token || Boolean(busy)}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Import this file?',
                          message: 'Rows already here are overwritten. This cannot be undone — make sure you have a backup.',
                          confirmLabel: 'Import',
                          danger: true,
                        });
                        if (!ok) return;
                        await run('Importing', async () => {
                          const result = await runImport(payload, check.token);
                          notify.success('Import finished', `${result.rowsWritten} rows written.`);
                          setCheck(null);
                          setPayload(null);
                          await refresh();
                        });
                      }}
                    >
                      {check.token ? 'Import' : 'Fix the problems above first'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </WidgetCard>
        )}
      </div>
    </div>
  );
};

export default SchoolDataWorkspace;
