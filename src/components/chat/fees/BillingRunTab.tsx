import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileStack, Receipt, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate } from '@/lib/format';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import StatTile from '@/components/common/StatTile';
import type { BillingPreview, FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';

const BillingRunTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { user } = useAuth();
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [feeStructureId, setFeeStructureId] = useState('');
  const [classSection, setClassSection] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  useEffect(() => {
    callFees<{ structures: FeeStructure[] }>('list_fee_structures', {}, user)
      .then(data => {
        setStructures(data.structures);
        setFeeStructureId(current => current || data.structures[0]?.id || '');
      })
      .catch(err => console.error('Failed to load fee structures:', err));
  }, [user]);

  const loadPreview = useCallback(
    () =>
      runAction('Building billing preview', async () => {
        setResult(null);
        const data = await callFees<BillingPreview>(
          'preview_billing_run',
          { feeStructureId, classSection: classSection || undefined, dueDate: dueDate || undefined },
          user,
        );
        setPreview(data);
      }),
    [classSection, dueDate, feeStructureId, runAction, user],
  );

  const bill = () =>
    runAction('Running billing', async () => {
      const data = await callFees<{ created: number; skipped: number }>(
        'run_billing',
        { feeStructureId, classSection: classSection || undefined, dueDate: dueDate || undefined, confirm: true },
        user,
      );
      setConfirming(false);
      setResult(data);
      await loadPreview();
      onChanged();
    });

  const selected = structures.find(structure => structure.id === feeStructureId);

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Field
              label="Fee structure"
              value={feeStructureId}
              onChange={value => { setFeeStructureId(String(value)); setPreview(null); setResult(null); }}
              options={[
                { value: '', label: structures.length ? 'Select a structure' : 'No active fee structures' },
                ...structures.map(structure => ({
                  value: structure.id,
                  label: `${structure.name} · ${structure.term} ${structure.academic_year}`,
                })),
              ]}
            />
          </div>
          <Field
            label="Class section"
            value={classSection}
            onChange={value => setClassSection(String(value))}
            placeholder="All sections"
          />
          <Field
            label="Due date override"
            type="date"
            value={dueDate}
            onChange={value => setDueDate(String(value))}
            hint={selected?.due_date ? `Default ${formatDate(selected.due_date)}` : undefined}
          />
        </div>
        <div className="flex justify-end mt-3">
          <PrimaryButton onClick={loadPreview} disabled={!feeStructureId}>
            <Search className="w-4 h-4" /> Preview
          </PrimaryButton>
        </div>
      </Panel>

      {result && (
        <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5" />
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Created {result.created} invoice{result.created === 1 ? '' : 's'}.
            {result.skipped > 0 && ` ${result.skipped} student${result.skipped === 1 ? ' was' : 's were'} already invoiced for this structure and ${result.skipped === 1 ? 'was' : 'were'} skipped.`}
          </p>
        </div>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Students matched" value={String(preview.totals.students)} icon={FileStack} />
            <StatTile label="To be billed" value={String(preview.totals.billable)} icon={Receipt} />
            <StatTile label="Bursaries applied" value={formatAmount(preview.totals.discount, preview.totals.currency)} icon={CheckCircle2} tone="success" />
            <StatTile label="Net to bill" value={formatAmount(preview.totals.net, preview.totals.currency)} icon={Receipt} />
          </div>

          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Student</th>
                    <th className="text-left font-medium px-4 py-2.5">Class</th>
                    <th className="text-right font-medium px-4 py-2.5">Gross</th>
                    <th className="text-right font-medium px-4 py-2.5">Bursary</th>
                    <th className="text-right font-medium px-4 py-2.5">Net</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {preview.rows.map(row => (
                    <tr key={row.student_id} className={zebra}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800 dark:text-white">{row.full_name}</p>
                        <p className="text-xs text-gray-400">{row.student_number}</p>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                        Grade {row.grade_level} {row.class_section}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">
                        {formatAmount(row.gross, preview.totals.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                        {row.discount_total > 0 ? `− ${formatAmount(row.discount_total, preview.totals.currency)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">
                        {formatAmount(row.net, preview.totals.currency)}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.already_invoiced ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700">
                            Already invoiced · {row.existing_invoice_number}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">
                            Will be billed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex justify-end">
            <PrimaryButton onClick={() => setConfirming(true)} disabled={preview.totals.billable === 0}>
              <Receipt className="w-4 h-4" />
              {preview.totals.billable === 0
                ? 'Everyone is already invoiced'
                : `Bill ${preview.totals.billable} student${preview.totals.billable === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>
        </>
      )}

      {!preview && !result && (
        <Panel>
          <EmptyState message="Choose a fee structure and preview the run to see exactly who will be billed and for how much." />
        </Panel>
      )}

      {confirming && preview && (
        <ModalShell
          title="Confirm billing run"
          subtitle={`${preview.feeStructure.name} · ${preview.feeStructure.term} ${preview.feeStructure.academic_year}`}
          icon={Receipt}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirming(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={bill}>Confirm &amp; Bill</PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This raises <span className="font-medium">{preview.totals.billable}</span> invoice
            {preview.totals.billable === 1 ? '' : 's'} totalling{' '}
            <span className="font-medium">{formatAmount(preview.totals.net, preview.totals.currency)}</span>, due{' '}
            {formatDate(preview.dueDate)}.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Students already invoiced for this structure are skipped, so running it again is safe.
          </p>
        </ModalShell>
      )}
    </div>
  );
};

export default BillingRunTab;
