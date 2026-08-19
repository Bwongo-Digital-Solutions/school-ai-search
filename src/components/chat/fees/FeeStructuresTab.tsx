import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { academicYear, formatAmount, formatDate, TERMS } from '@/lib/format';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import type { FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';

const emptyForm = () => ({
  id: '',
  name: '',
  gradeLevel: '',
  studentType: 'day',
  academicYear: academicYear(),
  term: TERMS[0],
  amount: 0,
  currency: 'UGX',
  dueDate: '',
  description: '',
});

type FormState = ReturnType<typeof emptyForm>;

const FeeStructuresTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { user } = useAuth();
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FeeStructure | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callFees<{ structures: FeeStructure[] }>('list_fee_structures', { includeArchived }, user);
      setStructures(data.structures);
    } catch (err) {
      console.error('Failed to load fee structures:', err);
      setStructures([]);
    }
    setLoading(false);
  }, [includeArchived, user]);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof FormState) => (value: unknown) =>
    setForm(current => (current ? { ...current, [key]: value } as FormState : current));

  const save = () =>
    runAction('Saving fee structure', async () => {
      if (!form) return;
      await callFees('save_fee_structure', { ...form, id: form.id || undefined }, user);
      setForm(null);
      await load();
      onChanged();
    });

  const remove = () =>
    runAction('Removing fee structure', async () => {
      if (!confirmDelete) return;
      const result = await callFees<{ archived: boolean }>('delete_fee_structure', { id: confirmDelete.id }, user);
      setConfirmDelete(null);
      await load();
      onChanged();
      if (result.archived) {
        alert('This tier had already raised invoices, so it was archived instead of deleted. Existing invoices are unaffected.');
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={event => setIncludeArchived(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
          />
          Show archived tiers
        </label>
        <PrimaryButton onClick={() => setForm(emptyForm())}>
          <Plus className="w-4 h-4" /> New Fee Structure
        </PrimaryButton>
      </div>

      <Panel className="overflow-hidden">
        {loading ? (
          <EmptyState message="Loading fee structures…" />
        ) : structures.length === 0 ? (
          <EmptyState message="No fee structures yet. Create one to start billing." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Structure</th>
                  <th className="text-left font-medium px-4 py-2.5">Applies to</th>
                  <th className="text-left font-medium px-4 py-2.5">Period</th>
                  <th className="text-right font-medium px-4 py-2.5">Amount</th>
                  <th className="text-left font-medium px-4 py-2.5">Due</th>
                  <th className="text-right font-medium px-4 py-2.5">Invoices</th>
                  <th className="text-right font-medium px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {structures.map(structure => (
                  <tr key={structure.id} className={zebra}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800 dark:text-white">{structure.name}</p>
                      {structure.description && <p className="text-xs text-gray-400">{structure.description}</p>}
                      {structure.status !== 'active' && (
                        <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] border bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700">
                          <Archive className="w-2.5 h-2.5" /> Archived
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {structure.grade_level === null ? 'All grades' : `Grade ${structure.grade_level}`} · {structure.student_type}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {structure.term} {structure.academic_year}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">
                      {formatAmount(structure.amount, structure.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(structure.due_date)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{structure.invoice_count}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setForm({
                            id: structure.id,
                            name: structure.name,
                            gradeLevel: structure.grade_level === null ? '' : String(structure.grade_level),
                            studentType: structure.student_type,
                            academicYear: structure.academic_year,
                            term: structure.term,
                            amount: structure.amount,
                            currency: structure.currency,
                            dueDate: structure.due_date ? structure.due_date.slice(0, 10) : '',
                            description: structure.description,
                          })}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label={`Edit ${structure.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(structure)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                          aria-label={`Delete ${structure.name}`}
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
          title={form.id ? 'Edit Fee Structure' : 'New Fee Structure'}
          subtitle="Defines what a cohort is charged for one term."
          icon={Layers}
          onClose={() => setForm(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setForm(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={save}>Save</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" value={form.name} onChange={set('name')} placeholder="Grade 10 Day Tuition" />
            <Field label="Amount" type="number" min={0} value={form.amount} onChange={set('amount')} />
            <Field
              label="Grade level"
              value={form.gradeLevel}
              onChange={set('gradeLevel')}
              placeholder="Leave blank for all grades"
              hint="Blank bills every grade."
            />
            <Field
              label="Student type"
              value={form.studentType}
              onChange={set('studentType')}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'boarding', label: 'Boarding' },
              ]}
            />
            <Field label="Academic year" value={form.academicYear} onChange={set('academicYear')} />
            <Field
              label="Term"
              value={form.term}
              onChange={set('term')}
              options={TERMS.map(term => ({ value: term, label: term }))}
            />
            <Field label="Currency" value={form.currency} onChange={set('currency')} />
            <Field label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />
            <div className="sm:col-span-2">
              <Field label="Description" type="textarea" value={form.description} onChange={set('description')} />
            </div>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ModalShell
          title="Remove fee structure"
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
            Remove <span className="font-medium">{confirmDelete.name}</span>?
          </p>
          {confirmDelete.invoice_count > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              {confirmDelete.invoice_count} invoice{confirmDelete.invoice_count === 1 ? '' : 's'} already reference this
              tier, so it will be archived rather than deleted. Those invoices stay exactly as they are.
            </p>
          )}
        </ModalShell>
      )}
    </div>
  );
};

export default FeeStructuresTab;
