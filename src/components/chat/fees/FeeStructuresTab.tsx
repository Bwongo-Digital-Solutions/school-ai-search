import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { callFees } from '@/lib/fees';
import { academicYear, formatAmount, formatDate, TERMS } from '@/lib/format';
import { classLabel } from '@/lib/classLevels';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import type { FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';
import styles from '../tabs.module.scss';
import { Add, Archive, Edit, Layers, TrashCan } from '@carbon/react/icons';
import { Button, Checkbox, Tag } from '@carbon/react';

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
  const { settings } = useSettings();
  const { notify } = useNotifications();
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
        notify.info(
          'Archived instead of deleted',
          'This tier had already raised invoices. Those invoices are unaffected.',
        );
      }
    });

  return (
    <div className={styles.stack}>
      <div className={styles.between}>
        <Checkbox
          id="includeArchived"
          labelText="Show archived tiers"
          checked={includeArchived}
          onChange={(_event, { checked }) => setIncludeArchived(checked)}
        />
        <PrimaryButton onClick={() => setForm(emptyForm())}>
          <Add size={16} /> New Fee Structure
        </PrimaryButton>
      </div>

      <Panel >
        {loading ? (
          <EmptyState message="Loading fee structures…" />
        ) : structures.length === 0 ? (
          <EmptyState message="No fee structures yet. Create one to start billing." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  <th>Structure</th>
                  <th>Applies to</th>
                  <th>Period</th>
                  <th className={styles.numeric}>Amount</th>
                  <th>Due</th>
                  <th className={styles.numeric}>Invoices</th>
                  <th className={styles.numeric}>Actions</th>
                </tr>
              </thead>
              <tbody className={styles.rows}>
                {structures.map(structure => (
                  <tr key={structure.id} className={zebra}>
                    <td>
                      <p className={styles.strong}>{structure.name}</p>
                      {structure.description && <p className={styles.note}>{structure.description}</p>}
                      {structure.status !== 'active' && (
                        <Tag type="cool-gray" size="sm" renderIcon={Archive}>
                          Archived
                        </Tag>
                      )}
                    </td>
                    <td>
                      {structure.grade_level === null
                        ? 'All classes'
                        : classLabel(settings.school_level, structure.grade_level)}{' '}
                      · {structure.student_type}
                    </td>
                    <td>
                      {structure.term} {structure.academic_year}
                    </td>
                    <td className={styles.tdStrong}>
                      {formatAmount(structure.amount, structure.currency)}
                    </td>
                    <td>{formatDate(structure.due_date)}</td>
                    <td className={styles.tdNumeric}>{structure.invoice_count}</td>
                    <td>
                      <div className={styles.actionsEnd}>
                        <Button
                          hasIconOnly
                          kind="ghost"
                          size="sm"
                          renderIcon={Edit}
                          iconDescription={`Edit ${structure.name}`}
                          tooltipPosition="left"
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
                        />
                        <Button
                          hasIconOnly
                          kind="danger--ghost"
                          size="sm"
                          renderIcon={TrashCan}
                          iconDescription={`Delete ${structure.name}`}
                          tooltipPosition="left"
                          onClick={() => setConfirmDelete(structure)}
                        />
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
          <div className={styles.grid2}>
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
            <div className={styles.spanAll}>
              <Field label="Description" type="textarea" value={form.description} onChange={set('description')} />
            </div>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ModalShell
          title="Remove fee structure"
          icon={TrashCan}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirmDelete(null)}>Cancel</SecondaryButton>
              <Button kind="danger" size="sm" onClick={remove}>
                Remove
              </Button>
            </>
          }
        >
          <p className={styles.primary}>
            Remove <span className={styles.strong}>{confirmDelete.name}</span>?
          </p>
          {confirmDelete.invoice_count > 0 && (
            <p className={styles.warn}>
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
