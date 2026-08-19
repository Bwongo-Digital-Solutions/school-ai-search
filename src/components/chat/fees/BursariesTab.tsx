import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate } from '@/lib/format';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import type { Bursary, FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';

const emptyForm = () => ({
  id: '',
  studentId: '',
  name: '',
  sponsor: '',
  discountType: 'percentage',
  discountValue: 0,
  feeStructureId: '',
  academicYear: '',
  term: '',
  startDate: '',
  endDate: '',
  status: 'active',
  notes: '',
});

type FormState = ReturnType<typeof emptyForm>;

const BursariesTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { user } = useAuth();
  const { students } = useChatContext();
  const [bursaries, setBursaries] = useState<Bursary[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Bursary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, structureList] = await Promise.all([
        callFees<{ bursaries: Bursary[] }>('list_bursaries', {}, user),
        callFees<{ structures: FeeStructure[] }>('list_fee_structures', {}, user),
      ]);
      setBursaries(list.bursaries);
      setStructures(structureList.structures);
    } catch (err) {
      console.error('Failed to load bursaries:', err);
      setBursaries([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof FormState) => (value: unknown) =>
    setForm(current => (current ? { ...current, [key]: value } as FormState : current));

  const save = () =>
    runAction('Saving bursary', async () => {
      if (!form) return;
      await callFees('save_bursary', { ...form, id: form.id || undefined }, user);
      setForm(null);
      await load();
      onChanged();
    });

  const remove = () =>
    runAction('Removing bursary', async () => {
      if (!confirmDelete) return;
      await callFees('delete_bursary', { id: confirmDelete.id }, user);
      setConfirmDelete(null);
      await load();
      onChanged();
    });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 text-indigo-500" />
          <p>
            A bursary reduces invoices raised <span className="font-medium">after</span> it is created. Invoices already
            issued keep the discount they were raised with, so past receipts stay correct.
          </p>
        </div>
        <PrimaryButton onClick={() => setForm(emptyForm())}>
          <Plus className="w-4 h-4" /> New Bursary
        </PrimaryButton>
      </div>

      <Panel className="overflow-hidden">
        {loading ? (
          <EmptyState message="Loading bursaries…" />
        ) : bursaries.length === 0 ? (
          <EmptyState message="No bursaries have been awarded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Student</th>
                  <th className="text-left font-medium px-4 py-2.5">Bursary</th>
                  <th className="text-right font-medium px-4 py-2.5">Discount</th>
                  <th className="text-left font-medium px-4 py-2.5">Applies to</th>
                  <th className="text-left font-medium px-4 py-2.5">Valid</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-right font-medium px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {bursaries.map(bursary => (
                  <tr key={bursary.id} className={zebra}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800 dark:text-white">{bursary.full_name}</p>
                      <p className="text-xs text-gray-400">{bursary.student_number}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-gray-700 dark:text-gray-200">{bursary.name}</p>
                      {bursary.sponsor && <p className="text-xs text-gray-400">{bursary.sponsor}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400">
                      {bursary.discount_type === 'percentage'
                        ? `${bursary.discount_value}%`
                        : formatAmount(bursary.discount_value, 'UGX')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 text-xs">
                      {bursary.fee_structure_id
                        ? structures.find(structure => structure.id === bursary.fee_structure_id)?.name || 'One structure'
                        : 'All fee structures'}
                      {(bursary.academic_year || bursary.term) && (
                        <span className="block text-gray-400">
                          {[bursary.term, bursary.academic_year].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300">
                      {bursary.start_date || bursary.end_date
                        ? `${formatDate(bursary.start_date)} → ${formatDate(bursary.end_date)}`
                        : 'No limit'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        bursary.status === 'active'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'
                      }`}>
                        {bursary.status === 'active' ? 'Active' : 'Ended'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setForm({
                            id: bursary.id,
                            studentId: bursary.student_id,
                            name: bursary.name,
                            sponsor: bursary.sponsor,
                            discountType: bursary.discount_type,
                            discountValue: bursary.discount_value,
                            feeStructureId: bursary.fee_structure_id || '',
                            academicYear: bursary.academic_year || '',
                            term: bursary.term || '',
                            startDate: bursary.start_date ? bursary.start_date.slice(0, 10) : '',
                            endDate: bursary.end_date ? bursary.end_date.slice(0, 10) : '',
                            status: bursary.status,
                            notes: bursary.notes,
                          })}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label={`Edit ${bursary.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(bursary)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                          aria-label={`Delete ${bursary.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {form && (
        <ModalShell
          title={form.id ? 'Edit Bursary' : 'New Bursary'}
          subtitle="Scholarships, sponsorships and sibling discounts."
          icon={GraduationCap}
          onClose={() => setForm(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setForm(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={save}>Save</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Field
                label="Student"
                value={form.studentId}
                onChange={set('studentId')}
                options={[
                  { value: '', label: 'Select a student' },
                  ...students.map(student => ({
                    value: student.id,
                    label: `${student.first_name} ${student.last_name} · ${student.student_id}`,
                  })),
                ]}
              />
            </div>
            <Field label="Bursary name" value={form.name} onChange={set('name')} placeholder="Hardship Grant" />
            <Field label="Sponsor" value={form.sponsor} onChange={set('sponsor')} placeholder="Optional" />
            <Field
              label="Discount type"
              value={form.discountType}
              onChange={set('discountType')}
              options={[
                { value: 'percentage', label: 'Percentage of fee' },
                { value: 'fixed', label: 'Fixed amount' },
              ]}
            />
            <Field
              label={form.discountType === 'percentage' ? 'Percentage (1–100)' : 'Amount'}
              type="number"
              min={0}
              max={form.discountType === 'percentage' ? 100 : undefined}
              value={form.discountValue}
              onChange={set('discountValue')}
            />
            <div className="sm:col-span-2">
              <Field
                label="Fee structure"
                value={form.feeStructureId}
                onChange={set('feeStructureId')}
                options={[
                  { value: '', label: 'All fee structures' },
                  ...structures.map(structure => ({
                    value: structure.id,
                    label: `${structure.name} · ${structure.term} ${structure.academic_year}`,
                  })),
                ]}
                hint="Leave as all structures for a general award."
              />
            </div>
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} placeholder="Any" />
            <Field label="Term" value={form.term} onChange={set('term')} placeholder="Any" />
            <Field label="Valid from" type="date" value={form.startDate} onChange={set('startDate')} />
            <Field label="Valid until" type="date" value={form.endDate} onChange={set('endDate')} />
            <Field
              label="Status"
              value={form.status}
              onChange={set('status')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'ended', label: 'Ended' },
              ]}
            />
            <div className="sm:col-span-2">
              <Field label="Notes" type="textarea" value={form.notes} onChange={set('notes')} />
            </div>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ModalShell
          title="Remove bursary"
          icon={Trash2}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirmDelete(null)}>Cancel</SecondaryButton>
              <button
                onClick={remove}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              >
                Remove
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Remove <span className="font-medium">{confirmDelete.name}</span> from {confirmDelete.full_name}?
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Invoices already raised keep the discount they were issued with. Only future billing runs are affected.
          </p>
        </ModalShell>
      )}
    </div>
  );
};

export default BursariesTab;
