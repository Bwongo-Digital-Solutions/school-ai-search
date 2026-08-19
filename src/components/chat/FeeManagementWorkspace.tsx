import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Gauge,
  GraduationCap,
  Landmark,
  Layers,
  Loader2,
  Receipt,
  Shield,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { formatAmount } from '@/lib/format';
import StatTile from '@/components/common/StatTile';
import type { FeesSummary } from '@/types/feeAdmin';
import FeeStructuresTab from './fees/FeeStructuresTab';
import BillingRunTab from './fees/BillingRunTab';
import RecordPaymentTab from './fees/RecordPaymentTab';
import StudentLedgerTab from './fees/StudentLedgerTab';
import ArrearsReportTab from './fees/ArrearsReportTab';
import BursariesTab from './fees/BursariesTab';
import FeeRatingsTab from './fees/FeeRatingsTab';

const SECTIONS = [
  { key: 'structures', label: 'Fee Structures', icon: Layers },
  { key: 'billing', label: 'Billing Run', icon: Receipt },
  { key: 'payments', label: 'Record Payment', icon: Wallet },
  { key: 'ledger', label: 'Student Ledger', icon: BookOpen },
  { key: 'arrears', label: 'Arrears', icon: AlertTriangle },
  { key: 'bursaries', label: 'Bursaries', icon: GraduationCap },
  { key: 'ratings', label: 'Payment Ratings', icon: Gauge },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const FeeManagementWorkspace: React.FC = () => {
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
      alert(`${label} failed: ${err instanceof Error ? err.message : 'Unexpected error'}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const openLedger = useCallback((studentId: string) => {
    setLedgerStudentId(studentId);
    setSection('ledger');
  }, []);

  // Defence in depth. Support staff never reach this component (AppLayout short-circuits them to
  // the fee status panel) and the nav entry is admin-only, but a teacher must see nothing here
  // even if the view is somehow selected.
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900 p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Admin Access Required</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Fee management — structures, invoicing, payments and payment ratings — is only accessible to
            administrators.
          </p>
        </div>
      </div>
    );
  }

  const currency = summary?.totals.currency || 'UGX';

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Landmark className="w-6 h-6 text-indigo-500" />
              Fee Management
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Fee structures, invoicing, payments, bursaries and payment ratings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy && (
              <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy}…
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
              <Shield className="w-3 h-3" /> Admin Only
            </span>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
            <StatTile label="Invoiced" value={formatAmount(summary.totals.invoiced, currency)} icon={Receipt} />
            <StatTile label="Collected" value={formatAmount(summary.totals.collected, currency)} icon={Wallet} tone="success" />
            <StatTile label="Outstanding" value={formatAmount(summary.totals.outstanding, currency)} icon={AlertTriangle} tone="warning" />
            <StatTile label="Overdue students" value={String(summary.counts.overdueStudents)} icon={AlertTriangle} tone="danger" />
            <StatTile
              label="Reviews due"
              value={String(summary.counts.reviewsDue)}
              icon={Gauge}
              tone={summary.counts.reviewsDue > 0 ? 'warning' : 'default'}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-4">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                section === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
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
