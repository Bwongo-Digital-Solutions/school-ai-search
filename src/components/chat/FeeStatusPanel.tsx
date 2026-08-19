import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Receipt, RefreshCw, ScanLine, Search, Wallet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatAmount, formatDate } from '@/lib/format';
import StatTile from '@/components/common/StatTile';
import StudentIdScanner from './StudentIdScanner';
import type { FeeStatus, StudentFeeStatus } from '@/types/fees';

const STATUS_STYLES: Record<FeeStatus, { label: string; badge: string; icon: React.ElementType }> = {
  cleared: {
    label: 'Cleared',
    badge: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2,
  },
  partial: {
    label: 'Part Paid',
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    icon: Clock,
  },
  unpaid: {
    label: 'Unpaid',
    badge: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    icon: Clock,
  },
  overdue: {
    label: 'Overdue',
    badge: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
    icon: AlertTriangle,
  },
  no_invoices: {
    label: 'No Invoice',
    badge: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    icon: Receipt,
  },
};

const FeeStatusPanel: React.FC = () => {
  const { isAuthenticated } = useAuth();
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
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-8 text-center">
        <Wallet className="w-10 h-10 text-indigo-500 mb-3" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Sign In Required</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to view school fees payment status.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Wallet className="w-6 h-6 text-indigo-500" />
              School Fees Status
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Payment status only — no contact, academic, medical, or discipline records are shown here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScannerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:shadow-lg transition-all"
            >
              <ScanLine className="w-4 h-4" />
              Scan Student ID
            </button>
            <button
              onClick={loadFeeStatus}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <StatTile label="Outstanding" value={formatAmount(totals.outstanding, totals.currency)} icon={Wallet} />
          <StatTile label="Collected" value={formatAmount(totals.collected, totals.currency)} icon={Receipt} />
          <StatTile label="Overdue Students" value={String(totals.overdue)} icon={AlertTriangle} />
          <StatTile label="Cleared Students" value={String(totals.cleared)} icon={CheckCircle2} />
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by student name or number"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as FeeStatus | 'all')}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_STYLES) as FeeStatus[]).map(status => (
              <option key={status} value={status}>{STATUS_STYLES[status].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {scanning && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Looking up scanned ID
          </div>
        )}

        {scanMiss && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">No student matches that ID card</p>
                <p className="text-xs text-red-500/80 dark:text-red-400/80 mt-0.5">Scanned: {scanMiss}</p>
              </div>
            </div>
            <button onClick={() => setScanMiss(null)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40">
              <X className="w-4 h-4 text-red-400" />
            </button>
          </div>
        )}

        {scanned && (() => {
          const style = STATUS_STYLES[scanned.status] ?? STATUS_STYLES.no_invoices;
          const ScannedIcon = style.icon;
          return (
            <div className="mb-4 bg-white dark:bg-gray-800 border-2 border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800">
                <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <ScanLine className="w-3.5 h-3.5" /> Scanned ID Card
                </span>
                <button onClick={() => setScanned(null)} className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40">
                  <X className="w-4 h-4 text-indigo-400" />
                </button>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-gray-800 dark:text-white">{scanned.full_name}</p>
                    <p className="text-xs text-gray-400">
                      {scanned.student_number} · Grade {scanned.grade_level} {scanned.class_section}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${style.badge}`}>
                    <ScannedIcon className="w-3 h-3" /> {style.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <StatTile label="Invoiced" value={formatAmount(scanned.total_invoiced, scanned.currency)} icon={Receipt} />
                  <StatTile label="Paid" value={formatAmount(scanned.total_paid, scanned.currency)} icon={CheckCircle2} />
                  <StatTile label="Balance" value={formatAmount(scanned.balance_due, scanned.currency)} icon={Wallet} />
                  <StatTile label="Next Due" value={formatDate(scanned.next_due_date)} icon={Clock} />
                </div>
              </div>
            </div>
          );
        })()}

        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
          {loading ? (
            <div className="h-72 flex items-center justify-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading fee status
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              {rows.length === 0 ? 'No fee invoices have been recorded yet.' : 'No students match this filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Student</th>
                    <th className="text-left font-medium px-4 py-2.5">Class</th>
                    <th className="text-right font-medium px-4 py-2.5">Invoiced</th>
                    <th className="text-right font-medium px-4 py-2.5">Paid</th>
                    <th className="text-right font-medium px-4 py-2.5">Balance</th>
                    <th className="text-left font-medium px-4 py-2.5">Next Due</th>
                    <th className="text-left font-medium px-4 py-2.5">Last Payment</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map(row => {
                    const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.no_invoices;
                    const StatusIcon = style.icon;
                    return (
                      <tr key={row.student_id} className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-800 dark:even:bg-gray-900/30">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-800 dark:text-white">{row.full_name}</p>
                          <p className="text-xs text-gray-400">{row.student_number}</p>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                          Grade {row.grade_level} {row.class_section}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{formatAmount(row.total_invoiced, row.currency)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{formatAmount(row.total_paid, row.currency)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">{formatAmount(row.balance_due, row.currency)}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(row.next_due_date)}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(row.last_payment_at)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.badge}`}>
                            <StatusIcon className="w-2.5 h-2.5" /> {style.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-2 px-1">Showing {filtered.length} of {rows.length} students</p>
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
