import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useChatContext } from '@/contexts/ChatContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate } from '@/lib/format';
import Field from '@/components/common/Field';
import { StudentPicker } from '@/components/common';
import ModalShell from '@/components/common/ModalShell';
import type { Bursary, FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, SecondaryButton, zebra } from './shared';
import styles from '../tabs.module.scss';
import { Add, Edit, Education, Information, TrashCan } from '@carbon/react/icons';
import { Button, Tag } from '@carbon/react';

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
    <div className={styles.stack}>
      <div className={styles.betweenTop}>
        <div className={styles.noteRow}>
          <Information size={16} />
          <p>
            A bursary reduces invoices raised <span className={styles.strong}>after</span> it is created. Invoices already
            issued keep the discount they were raised with, so past receipts stay correct.
          </p>
        </div>
        <PrimaryButton onClick={() => setForm(emptyForm())}>
          <Add size={16} /> New Bursary
        </PrimaryButton>
      </div>

      <Panel >
        {loading ? (
          <EmptyState message="Loading bursaries…" />
        ) : bursaries.length === 0 ? (
          <EmptyState message="No bursaries have been awarded yet." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead className={styles.thead}>
                <tr>
                  <th>Student</th>
                  <th>Bursary</th>
                  <th className={styles.numeric}>Discount</th>
                  <th>Applies to</th>
                  <th>Valid</th>
                  <th>Status</th>
                  <th className={styles.numeric}>Actions</th>
                </tr>
              </thead>
              <tbody className={styles.rows}>
                {bursaries.map(bursary => (
                  <tr key={bursary.id} className={zebra}>
                    <td>
                      <p className={styles.strong}>{bursary.full_name}</p>
                      <p className={styles.note}>{bursary.student_number}</p>
                    </td>
                    <td>
                      <p className={styles.primary}>{bursary.name}</p>
                      {bursary.sponsor && <p className={styles.note}>{bursary.sponsor}</p>}
                    </td>
                    <td className={styles.tdPositive}>
                      {bursary.discount_type === 'percentage'
                        ? `${bursary.discount_value}%`
                        : formatAmount(bursary.discount_value, 'UGX')}
                    </td>
                    <td className={styles.td}>
                      {bursary.fee_structure_id
                        ? structures.find(structure => structure.id === bursary.fee_structure_id)?.name || 'One structure'
                        : 'All fee structures'}
                      {(bursary.academic_year || bursary.term) && (
                        <span className={styles.note}>
                          {[bursary.term, bursary.academic_year].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </td>
                    <td className={styles.td}>
                      {bursary.start_date || bursary.end_date
                        ? `${formatDate(bursary.start_date)} → ${formatDate(bursary.end_date)}`
                        : 'No limit'}
                    </td>
                    <td>
                      <Tag type={bursary.status === 'active' ? 'green' : 'cool-gray'} size="sm">
                        {bursary.status === 'active' ? 'Active' : 'Ended'}
                      </Tag>
                    </td>
                    <td>
                      <div className={styles.actionsEnd}>
                        <Button
                          hasIconOnly
                          kind="ghost"
                          size="sm"
                          renderIcon={Edit}
                          iconDescription={`Edit ${bursary.name}`}
                          tooltipPosition="left"
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
                        />
                        <Button
                          hasIconOnly
                          kind="danger--ghost"
                          size="sm"
                          renderIcon={TrashCan}
                          iconDescription={`Delete ${bursary.name}`}
                          tooltipPosition="left"
                          onClick={() => setConfirmDelete(bursary)}
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
          title={form.id ? 'Edit Bursary' : 'New Bursary'}
          subtitle="Scholarships, sponsorships and sibling discounts."
          icon={Education}
          onClose={() => setForm(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setForm(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={save}>Save</PrimaryButton>
            </>
          }
        >
          <div className={styles.grid2}>
            <div className={styles.spanAll}>
              <StudentPicker
                value={form.studentId}
                onChange={set('studentId')}
                students={students}
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
            <div className={styles.spanAll}>
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
            <div className={styles.spanAll}>
              <Field label="Notes" type="textarea" value={form.notes} onChange={set('notes')} />
            </div>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ModalShell
          title="Remove bursary"
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
            Remove <span className={styles.strong}>{confirmDelete.name}</span> from {confirmDelete.full_name}?
          </p>
          <p className={styles.note}>
            Invoices already raised keep the discount they were issued with. Only future billing runs are affected.
          </p>
        </ModalShell>
      )}
    </div>
  );
};

export default BursariesTab;
