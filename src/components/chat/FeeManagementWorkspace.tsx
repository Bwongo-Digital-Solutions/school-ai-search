import React, { useCallback, useEffect, useState } from 'react';
import { Button, InlineLoading, Tab, TabList, Tabs, Tag } from '@carbon/react';
import {
  Book,
  DocumentPdf,
  Education,
  Layers,
  Meter,
  Money,
  Receipt,
  UserAdmin,
  Wallet,
  Warning,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { callFees, feeDocumentUrl } from '@/lib/fees';
import { downloadFromUrl } from '@/lib/download';
import { formatAmount, todayIso } from '@/lib/format';
import { AccessDenied, PageHeader, StatRow, StatTile } from '@/components/common';
import styles from './workspace.module.scss';
import type { FeesSummary } from '@/types/feeAdmin';
import FeeStructuresTab from './fees/FeeStructuresTab';
import BillingRunTab from './fees/BillingRunTab';
import RecordPaymentTab from './fees/RecordPaymentTab';
import StudentLedgerTab from './fees/StudentLedgerTab';
import ArrearsReportTab from './fees/ArrearsReportTab';
import BursariesTab from './fees/BursariesTab';
import FeeRatingsTab from './fees/FeeRatingsTab';

const SECTIONS = [
  { key: 'structures', label: 'Fee structures', icon: Layers },
  { key: 'billing', label: 'Billing run', icon: Receipt },
  { key: 'payments', label: 'Record payment', icon: Wallet },
  { key: 'ledger', label: 'Student ledger', icon: Book },
  { key: 'arrears', label: 'Arrears', icon: Warning },
  { key: 'bursaries', label: 'Bursaries', icon: Education },
  { key: 'ratings', label: 'Payment ratings', icon: Meter },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const FeeManagementWorkspace: React.FC = () => {
  const { notify } = useNotifications();
  const { focus, clearFocus } = useChatContext();
  const { isAdmin } = useAuth();
  const { user } = useAuth();
  const [section, setSection] = useState<SectionKey>('structures');
  const [summary, setSummary] = useState<FeesSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledgerStudentId, setLedgerStudentId] = useState('');

  const loadSummary = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setSummary(await callFees<FeesSummary>('summary', {}, user));
    } catch (err) {
      console.error('Failed to load fees summary:', err);
    }
  }, [isAdmin, user]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  /**
   * Shared wrapper for every mutation on this screen, mirroring saveRecord in the records
   * workspace: one place that shows progress and surfaces the server's message on failure.
   */
  const runAction = useCallback(async (label: string, handler: () => Promise<void>) => {
    setBusy(label);
    try {
      await handler();
    } catch (err: unknown) {
      console.error(`${label} failed:`, err);
      notify.error(`${label} failed`, err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const openLedger = useCallback((studentId: string) => {
    setLedgerStudentId(studentId);
    setSection('ledger');
  }, []);

  // Arrived from a search hit on an invoice or a payment: open that student's ledger, which is the
  // screen that actually answers "what is this charge".
  useEffect(() => {
    if (focus?.view !== 'finance' || !focus.studentId) return;
    openLedger(focus.studentId);
    clearFocus();
  }, [focus, openLedger, clearFocus]);

  // Defence in depth. Support staff never reach this component (AppLayout short-circuits them to
  // the fee status panel) and the nav entry is admin-only, but a teacher must see nothing here
  // even if the view is somehow selected.
  if (!isAdmin) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Fee management — structures, billing runs, bursaries and payments — is available to administrators."
      />
    );
  }

  const currency = summary?.totals.currency || 'UGX';

  return (
    <div className={styles.screen}>
      <PageHeader title="Fee management" illustration={<Money size={32} />}>
        {busy && (
          <span className={styles.busy}>
            <InlineLoading description={`${busy}…`} />
          </span>
        )}
        <Tag type="purple" size="sm" renderIcon={UserAdmin}>
          Administrators only
        </Tag>
        <Button
          kind="primary"
          size="sm"
          renderIcon={DocumentPdf}
          disabled={Boolean(busy)}
          onClick={() =>
            runAction('Generating financial report', async () => {
              await downloadFromUrl(
                feeDocumentUrl('/api/fees/report.pdf', user),
                `financial-report-${todayIso()}.pdf`,
              );
            })
          }
        >
          Financial report
        </Button>
      </PageHeader>

      <div className={styles.controls}>
        {summary && (
          <StatRow>
            <StatTile label="Invoiced" value={formatAmount(summary.totals.invoiced, currency)} icon={Receipt} />
            <StatTile
              label="Collected"
              value={formatAmount(summary.totals.collected, currency)}
              icon={Wallet}
              tone="success"
            />
            <StatTile
              label="Outstanding"
              value={formatAmount(summary.totals.outstanding, currency)}
              icon={Warning}
              tone="warning"
            />
            <StatTile
              label="Overdue students"
              value={String(summary.counts.overdueStudents)}
              icon={Warning}
              tone="danger"
            />
            <StatTile
              label="Reviews due"
              value={String(summary.counts.reviewsDue)}
              icon={Meter}
              tone={summary.counts.reviewsDue > 0 ? 'warning' : 'default'}
            />
          </StatRow>
        )}

        <div className={styles.tabs}>
          <Tabs
            selectedIndex={SECTIONS.findIndex(entry => entry.key === section)}
            onChange={({ selectedIndex }) => setSection(SECTIONS[selectedIndex].key)}
          >
            <TabList aria-label="Fee management sections" contained>
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
        {section === 'structures' && <FeeStructuresTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'billing' && <BillingRunTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'payments' && <RecordPaymentTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'ledger' && (
          <StudentLedgerTab
            runAction={runAction}
            onChanged={loadSummary}
            studentId={ledgerStudentId}
            setStudentId={setLedgerStudentId}
          />
        )}
        {section === 'arrears' && <ArrearsReportTab runAction={runAction} />}
        {section === 'bursaries' && <BursariesTab runAction={runAction} onChanged={loadSummary} />}
        {section === 'ratings' && (
          <FeeRatingsTab runAction={runAction} onChanged={loadSummary} onOpenLedger={openLedger} />
        )}
      </div>
    </div>
  );
};

export default FeeManagementWorkspace;
