import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { callFees } from '@/lib/fees';
import { formatAmount, formatDate } from '@/lib/format';
import { classAndSection } from '@/lib/classLevels';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import StatTile from '@/components/common/StatTile';
import { TablePager } from '@/components/common';
import { usePagedRows } from '@/hooks/usePagedRows';
import type { BillingPreview, FeeStructure } from '@/types/feeAdmin';
import { EmptyState, Panel, PrimaryButton, PrintButtons, SecondaryButton, zebra } from './shared';
import styles from '../tabs.module.scss';
import { CheckmarkFilled, DocumentMultiple_01, Receipt, Search } from '@carbon/react/icons';
import { InlineNotification, Tag } from '@carbon/react';

/** Stable identity for "no preview yet", so the pager's memo does not churn on every render. */
const NO_ROWS: BillingPreview['rows'] = [];

const BillingRunTab = ({ runAction, onChanged }: { runAction: (label: string, handler: () => Promise<void>) => Promise<void>; onChanged: () => void }) => {
  const { settings } = useSettings();
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

  // One row per student the run matched, so an unfiltered structure previews the whole school. The
  // tiles above and the Bill button below stay whole-preview — they are the totals being committed,
  // and a page's worth of them would be a number nobody wants.
  const { page, setPage, pageCount, pageRows, firstOnPage, lastOnPage } = usePagedRows(
    preview?.rows ?? NO_ROWS,
    25,
  );

  const selected = structures.find(structure => structure.id === feeStructureId);

  return (
    <div className={styles.stack}>
      <Panel className={styles.pad}>
        <div className={styles.grid4}>
          <div className={styles.spanAll}>
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
        <div className={styles.actionsEnd}>
          {/* Printed off the preview, before anything is invoiced: the sheet a head signs to
              approve the run. Every filter the preview was taken under goes with it, so the paper
              is the same run that is about to be confirmed. */}
          <PrintButtons
            path="/api/fees/billing-run.pdf"
            filename="billing-run.pdf"
            params={{
              feeStructureId,
              ...(classSection ? { classSection } : {}),
              ...(dueDate ? { dueDate } : {}),
            }}
            user={user}
            runAction={runAction}
            disabled={!feeStructureId || !preview}
          />
          <PrimaryButton onClick={loadPreview} disabled={!feeStructureId}>
            <Search size={16} /> Preview
          </PrimaryButton>
        </div>
      </Panel>

      {result && (
        <InlineNotification
          kind="success"
          title={`Created ${result.created} invoice${result.created === 1 ? '' : 's'}`}
          subtitle={
            result.skipped > 0
              ? `${result.skipped} student${result.skipped === 1 ? ' was' : 's were'} already invoiced for this structure and ${result.skipped === 1 ? 'was' : 'were'} skipped.`
              : undefined
          }
          lowContrast
          hideCloseButton
        />
      )}

      {preview && (
        <>
          <div className={styles.grid4}>
            <StatTile label="Students matched" value={String(preview.totals.students)} icon={DocumentMultiple_01} />
            <StatTile label="To be billed" value={String(preview.totals.billable)} icon={Receipt} />
            <StatTile label="Bursaries applied" value={formatAmount(preview.totals.discount, preview.totals.currency)} icon={CheckmarkFilled} tone="success" />
            <StatTile label="Net to bill" value={formatAmount(preview.totals.net, preview.totals.currency)} icon={Receipt} />
          </div>

          <Panel >
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead className={styles.thead}>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th className={styles.numeric}>Gross</th>
                    <th className={styles.numeric}>Bursary</th>
                    <th className={styles.numeric}>Net</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody className={styles.rows}>
                  {pageRows.map(row => (
                    <tr key={row.student_id} className={zebra}>
                      <td>
                        <p className={styles.strong}>{row.full_name}</p>
                        <p className={styles.note}>{row.student_number}</p>
                      </td>
                      <td>
                        {classAndSection(settings.school_level, row.grade_level, row.class_section)}
                      </td>
                      <td className={styles.tdNumeric}>
                        {formatAmount(row.gross, preview.totals.currency)}
                      </td>
                      <td className={styles.tdPositive}>
                        {row.discount_total > 0 ? `− ${formatAmount(row.discount_total, preview.totals.currency)}` : '—'}
                      </td>
                      <td className={styles.tdStrong}>
                        {formatAmount(row.net, preview.totals.currency)}
                      </td>
                      <td>
                        {row.already_invoiced ? (
                          <Tag type="cool-gray" size="sm">
                            Already invoiced · {row.existing_invoice_number}
                          </Tag>
                        ) : (
                          <Tag type="blue" size="sm">
                            Will be billed
                          </Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.rows.length > 0 && (
              <div className={styles.tableFoot}>
                <TablePager
                  page={page}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  firstOnPage={firstOnPage}
                  lastOnPage={lastOnPage}
                  total={preview.rows.length}
                  noun="student"
                />
              </div>
            )}
          </Panel>

          <div className={styles.actionsEnd}>
            <PrimaryButton onClick={() => setConfirming(true)} disabled={preview.totals.billable === 0}>
              <Receipt size={16} />
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
          <p className={styles.primary}>
            This raises <span className={styles.strong}>{preview.totals.billable}</span> invoice
            {preview.totals.billable === 1 ? '' : 's'} totalling{' '}
            <span className={styles.strong}>{formatAmount(preview.totals.net, preview.totals.currency)}</span>, due{' '}
            {formatDate(preview.dueDate)}.
          </p>
          <p className={styles.note}>
            Students already invoiced for this structure are skipped, so running it again is safe.
          </p>
        </ModalShell>
      )}
    </div>
  );
};

export default BillingRunTab;
