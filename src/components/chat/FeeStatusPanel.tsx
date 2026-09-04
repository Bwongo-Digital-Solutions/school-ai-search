import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  InlineLoading,
  InlineNotification,
  Search as CarbonSearch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import {
  Checkmark,
  CheckmarkFilled,
  Close,
  DocumentPdf,
  Receipt,
  Renew,
  ScanAlt,
  Time,
  Wallet,
  Warning,
} from '@carbon/react/icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, formatDate, todayIso } from '@/lib/format';
import { classAndSection } from '@/lib/classLevels';
import {
  AccessDenied,
  CardHeader,
  EmptyState,
  PageHeader,
  StatRow,
  StatTile,
  TablePager,
  TableSkeleton,
  WidgetCard,
} from '@/components/common';
import StudentIdScanner from './StudentIdScanner';
import { usePagedRows } from '@/hooks/usePagedRows';
import styles from './workspace.module.scss';
import type { FeeStatus, StudentFeeStatus } from '@/types/fees';

type TagType = 'green' | 'teal' | 'magenta' | 'red' | 'cool-gray';

const STATUS_STYLES: Record<FeeStatus, { label: string; tag: TagType; icon: React.ElementType }> = {
  cleared: { label: 'Cleared', tag: 'green', icon: CheckmarkFilled },
  partial: { label: 'Part paid', tag: 'teal', icon: Time },
  unpaid: { label: 'Unpaid', tag: 'magenta', icon: Time },
  overdue: { label: 'Overdue', tag: 'red', icon: Warning },
  no_invoices: { label: 'No invoice', tag: 'cool-gray', icon: Receipt },
};

const STATUS_KEYS = Object.keys(STATUS_STYLES) as FeeStatus[];
const ALL_STATUSES = 'all' as const;

const FeeStatusPanel: React.FC = () => {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { settings } = useSettings();
  const { notify } = useNotifications();
  const [rows, setRows] = useState<StudentFeeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FeeStatus | 'all'>('all');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanned, setScanned] = useState<StudentFeeStatus | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const loadFeeStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ students: StudentFeeStatus[] }>('fee-status', {
        body: {},
      });
      if (error) throw error;
      setRows(data?.students || []);
    } catch (err) {
      console.error('Failed to load fee status:', err);
      setRows([]);
    }
    setLoading(false);
  }, []);

  const downloadReport = useCallback(async () => {
    try {
      await downloadFromUrl(feeDocumentUrl('/api/fees/report.pdf', user), `financial-report-${todayIso()}.pdf`);
    } catch (err) {
      notify.error('Could not build the financial report', err instanceof Error ? err.message : 'Unexpected error');
    }
  }, [user]);

  const lookUpCode = useCallback(async (code: string) => {
    setScannerOpen(false);
    setScanning(true);
    setScanned(null);
    setScanMiss(null);
    try {
      const { data, error } = await supabase.functions.invoke<{
        students: StudentFeeStatus[];
        matched?: boolean;
      }>('fee-status', { body: { code } });
      if (error) throw error;
      const match = data?.students?.[0];
      if (match) {
        setScanned(match);
      } else {
        setScanMiss(code);
      }
    } catch (err) {
      console.error('Student ID lookup failed:', err);
      setScanMiss(code);
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadFeeStatus();
  }, [isAuthenticated, loadFeeStatus]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!query) return true;
      return `${row.full_name} ${row.student_number}`.toLowerCase().includes(query);
    });
  }, [rows, search, statusFilter]);

  // One row per student, so this grows with the school exactly as the roster does.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(filtered, 25);

  const totals = useMemo(() => {
    const currency = rows[0]?.currency || 'UGX';
    return {
      currency,
      outstanding: rows.reduce((sum, row) => sum + row.balance_due, 0),
      collected: rows.reduce((sum, row) => sum + row.total_paid, 0),
      overdue: rows.filter(row => row.status === 'overdue').length,
      cleared: rows.filter(row => row.status === 'cleared').length,
    };
  }, [rows]);

  if (!isAuthenticated) {
    return (
      <AccessDenied
        title="Sign in to continue"
        message="School fees payment status is available to signed-in staff."
      />
    );
  }

  const scannedStyle = scanned ? STATUS_STYLES[scanned.status] ?? STATUS_STYLES.no_invoices : null;

  return (
    <div className={styles.screen}>
      <PageHeader title="School fees status" illustration={<Wallet size={32} />}>
        <Button kind="primary" size="sm" renderIcon={ScanAlt} onClick={() => setScannerOpen(true)}>
          Scan student ID
        </Button>
        {isAdmin && (
          <Button kind="ghost" size="sm" renderIcon={DocumentPdf} onClick={downloadReport}>
            Financial report
          </Button>
        )}
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={loadFeeStatus} disabled={loading}>
          Refresh
        </Button>
      </PageHeader>

      <div className={styles.controls}>
        <StatRow>
          <StatTile
            label="Outstanding"
            value={formatAmount(totals.outstanding, totals.currency)}
            icon={Wallet}
            tone={totals.outstanding > 0 ? 'warning' : 'success'}
          />
          <StatTile label="Collected" value={formatAmount(totals.collected, totals.currency)} icon={Receipt} tone="success" />
          <StatTile label="Overdue students" value={String(totals.overdue)} icon={Warning} tone={totals.overdue > 0 ? 'danger' : 'default'} />
          <StatTile label="Cleared students" value={String(totals.cleared)} icon={Checkmark} tone="success" />
        </StatRow>

        <div className={styles.toolbar}>
          <CarbonSearch
            id="fee-search"
            size="lg"
            labelText="Search students"
            placeholder="Search by student name or number…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
          />
          <Dropdown
            id="fee-status-filter"
            className={styles.filter}
            size="lg"
            titleText="Status"
            hideLabel
            label="All statuses"
            items={[ALL_STATUSES, ...STATUS_KEYS]}
            selectedItem={statusFilter}
            itemToString={(item) =>
              item === ALL_STATUSES || item == null ? 'All statuses' : STATUS_STYLES[item].label
            }
            onChange={({ selectedItem }) =>
              setStatusFilter((selectedItem ?? ALL_STATUSES) as FeeStatus | 'all')
            }
          />
        </div>
      </div>

      <div className={styles.body}>
        {scanning && (
          <WidgetCard padded>
            <InlineLoading description="Looking up the scanned ID…" />
          </WidgetCard>
        )}

        {scanMiss && (
          <InlineNotification
            kind="error"
            title="No student matches that ID card"
            subtitle={`Scanned: ${scanMiss}`}
            onCloseButtonClick={() => setScanMiss(null)}
            lowContrast
          />
        )}

        {scanned && scannedStyle && (
          <div className={styles.callout}>
            <div className={styles.calloutHead}>
              <span className={styles.calloutTitle}>
                <ScanAlt size={16} /> Scanned ID card
              </span>
              <Button
                hasIconOnly
                kind="ghost"
                size="sm"
                renderIcon={Close}
                iconDescription="Clear this result"
                tooltipPosition="left"
                onClick={() => setScanned(null)}
              />
            </div>
            <div className={styles.calloutBody}>
              <div className={styles.calloutIdentity}>
                <div>
                  <p className={styles.calloutName}>{scanned.full_name}</p>
                  <p className={styles.secondary}>
                    {scanned.student_number} · {classAndSection(settings.school_level, scanned.grade_level, scanned.class_section)}
                  </p>
                </div>
                <Tag type={scannedStyle.tag} size="sm" renderIcon={scannedStyle.icon}>
                  {scannedStyle.label}
                </Tag>
              </div>
              <StatRow>
                <StatTile label="Invoiced" value={formatAmount(scanned.total_invoiced, scanned.currency)} icon={Receipt} />
                <StatTile label="Paid" value={formatAmount(scanned.total_paid, scanned.currency)} icon={Checkmark} tone="success" />
                <StatTile label="Balance" value={formatAmount(scanned.balance_due, scanned.currency)} icon={Wallet} tone={scanned.balance_due > 0 ? 'warning' : 'success'} />
                <StatTile label="Next due" value={formatDate(scanned.next_due_date)} icon={Time} />
              </StatRow>
            </div>
          </div>
        )}

        <WidgetCard>
          <CardHeader title="Students">
            <TablePager
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              firstOnPage={firstOnPage}
              lastOnPage={lastOnPage}
              total={filtered.length}
              noun="student"
            />
          </CardHeader>

          {loading ? (
            <TableSkeleton rowCount={8} columnCount={8} />
          ) : filtered.length === 0 ? (
            <EmptyState
              headerTitle="Fees"
              displayText={rows.length === 0 ? 'fee invoices' : 'students matching this filter'}
              helperText={
                rows.length === 0
                  ? 'Invoices raised under Fee management will appear here.'
                  : 'Try a different search or status.'
              }
            />
          ) : (
            <div className={styles.tableWrap}>
              <Table size="sm" useZebraStyles>
                <TableHead>
                  <TableRow>
                    <TableHeader>Student</TableHeader>
                    <TableHeader>Class</TableHeader>
                    <TableHeader className={styles.numeric}>Invoiced</TableHeader>
                    <TableHeader className={styles.numeric}>Paid</TableHeader>
                    <TableHeader className={styles.numeric}>Balance</TableHeader>
                    <TableHeader>Next due</TableHeader>
                    <TableHeader>Last payment</TableHeader>
                    <TableHeader>Status</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((row) => {
                    const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.no_invoices;
                    return (
                      <TableRow key={row.student_id}>
                        <TableCell>
                          <p className={styles.primary}>{row.full_name}</p>
                          <p className={styles.secondary}>{row.student_number}</p>
                        </TableCell>
                        <TableCell>
                          {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                        </TableCell>
                        <TableCell className={styles.numeric}>
                          {formatAmount(row.total_invoiced, row.currency)}
                        </TableCell>
                        <TableCell className={styles.numeric}>
                          {formatAmount(row.total_paid, row.currency)}
                        </TableCell>
                        <TableCell className={`${styles.numeric} ${styles.strong}`}>
                          {formatAmount(row.balance_due, row.currency)}
                        </TableCell>
                        <TableCell>{formatDate(row.next_due_date)}</TableCell>
                        <TableCell>{formatDate(row.last_payment_at)}</TableCell>
                        <TableCell>
                          <Tag type={style.tag} size="sm" renderIcon={style.icon}>
                            {style.label}
                          </Tag>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </WidgetCard>
      </div>

      <StudentIdScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={lookUpCode}
        title="Scan Student ID Card"
        hint="Scan the QR code on the plastic card, or type the student number printed on it."
      />
    </div>
  );
};

export default FeeStatusPanel;
