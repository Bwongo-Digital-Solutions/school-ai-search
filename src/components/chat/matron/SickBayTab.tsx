import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tag, Toggle } from '@carbon/react';
import { Add, Renew } from '@carbon/react/icons';
import { CardHeader, EmptyState, Field, StudentPicker, TableSkeleton, WidgetCard } from '@/components/common';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { matronApi, type SickBayRecord } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}

const OUTCOMES = [
  { value: 'discharged', label: 'Discharged — back to class' },
  { value: 'referred', label: 'Referred to a clinic or hospital' },
  { value: 'sent_home', label: 'Sent home' },
];

const formatWhen = (value: string | null) =>
  (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * The sick bay book.
 *
 * A matron keeps one on paper, and the questions asked of it later are the reason this exists: was
 * my child seen last Tuesday, and is what half the dormitory has come down with the same thing.
 */
const SickBayTab: React.FC<Props> = ({ runAction, onChanged }) => {
  const { notify } = useNotifications();
  const { students } = useChatContext();

  const [records, setRecords] = useState<SickBayRecord[] | null>(null);
  const [includeDischarged, setIncludeDischarged] = useState(false);

  const [showAdmit, setShowAdmit] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [complaint, setComplaint] = useState('');
  const [temperature, setTemperature] = useState('');
  const [treatment, setTreatment] = useState('');

  const [discharging, setDischarging] = useState<SickBayRecord | null>(null);
  const [outcome, setOutcome] = useState('discharged');
  const [referredTo, setReferredTo] = useState('');
  const [parentInformed, setParentInformed] = useState(false);
  const [dischargeNote, setDischargeNote] = useState('');

  const load = useCallback(async () => {
    try {
      setRecords((await matronApi.sickBay(includeDischarged)).records);
    } catch (err) {
      console.error('Could not load the sick bay:', err);
      setRecords([]);
      notify.error('Could not load the sick bay', err instanceof Error ? err.message : undefined);
    }
  }, [includeDischarged, notify]);

  useEffect(() => { load(); }, [load]);

  const admit = () =>
    runAction('Admitting to the sick bay', async () => {
      if (!studentId) throw new Error('Choose the student.');
      if (!complaint.trim()) throw new Error('Say what the student is complaining of.');

      const result = await matronApi.admit(studentId, {
        complaint: complaint.trim(),
        temperature: temperature === '' ? undefined : Number(temperature),
        treatment,
      });

      // Already lying there: say so plainly rather than reporting a second admission.
      if (result.already) notify.info('Already in the sick bay', 'That episode is still open.');
      else notify.success('Admitted to the sick bay');

      setShowAdmit(false);
      setStudentId(''); setComplaint(''); setTemperature(''); setTreatment('');
      await load();
      onChanged();
    });

  const discharge = () =>
    runAction('Discharging', async () => {
      if (!discharging) return;
      await matronApi.discharge(discharging.id, {
        outcome, referredTo, parentInformed, note: dischargeNote,
      });
      notify.success(`${discharging.full_name} discharged`);
      setDischarging(null);
      setOutcome('discharged'); setReferredTo(''); setParentInformed(false); setDischargeNote('');
      await load();
      onChanged();
    });

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Sick bay">
          <Toggle
            id="sick-bay-history"
            size="sm"
            labelA="Currently in"
            labelB="Including discharged"
            toggled={includeDischarged}
            onToggle={setIncludeDischarged}
            hideLabel
          />
          <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>Refresh</Button>
          <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => setShowAdmit(true)}>
            Admit a student
          </Button>
        </CardHeader>

        {records === null ? (
          <TableSkeleton rowCount={5} columnLabels={['Student', 'Complaint', 'Admitted', 'State', '']} />
        ) : records.length === 0 ? (
          <EmptyState
            headerTitle="Sick bay"
            displayText={includeDischarged ? 'records' : 'students in the sick bay'}
            helperText={includeDischarged ? 'Nobody has been seen yet.' : 'Nobody is unwell just now.'}
            actionText="Admit a student"
            onAction={() => setShowAdmit(true)}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Complaint</th>
                  <th>Admitted</th>
                  <th>State</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.id}>
                    <td>
                      <p className={styles.primary}>{record.full_name}</p>
                      <p className={styles.secondary}>{record.student_number}</p>
                      {record.parent_phone && (
                        <p className={styles.secondary}>{record.parent_name} · {record.parent_phone}</p>
                      )}
                    </td>
                    <td>
                      <p className={styles.primary}>{record.complaint}</p>
                      {record.temperature && <p className={styles.secondary}>{record.temperature}°C</p>}
                      {record.treatment && <p className={styles.secondary}>{record.treatment}</p>}
                    </td>
                    <td>{formatWhen(record.admitted_at)}</td>
                    <td>
                      {record.open
                        ? <Tag type="purple" size="sm">In the sick bay</Tag>
                        : (
                          <>
                            <Tag type="gray" size="sm">{record.outcome.replace('_', ' ')}</Tag>
                            <p className={styles.secondary}>{formatWhen(record.discharged_at)}</p>
                            {record.referred_to && <p className={styles.secondary}>{record.referred_to}</p>}
                          </>
                        )}
                    </td>
                    <td>
                      {record.open && (
                        <Button kind="ghost" size="sm" onClick={() => setDischarging(record)}>
                          Discharge
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>

      {showAdmit && (
        <Modal
          open
          modalHeading="Admit to the sick bay"
          primaryButtonText="Admit"
          secondaryButtonText="Cancel"
          onRequestSubmit={admit}
          onRequestClose={() => setShowAdmit(false)}
          size="sm"
          hasScrollingContent
        >
          <div className={styles.stack}>
            <StudentPicker value={studentId} onChange={setStudentId} students={students} label="Student" />
            <Field label="What are they complaining of?" value={complaint} onChange={setComplaint} placeholder="Headache and fever" />
            <div className={styles.grid2}>
              <Field label="Temperature (°C)" value={temperature} onChange={v => setTemperature(String(v))} type="number" step={0.1} min={30} max={45} />
              <Field label="Treatment given" value={treatment} onChange={setTreatment} placeholder="Paracetamol" />
            </div>
            <p className={styles.noteRow}>
              Admitting also answers tonight&rsquo;s roll call, so you do not have to mark the same
              child twice.
            </p>
          </div>
        </Modal>
      )}

      {discharging && (
        <Modal
          open
          modalHeading={`Discharge ${discharging.full_name}`}
          primaryButtonText="Discharge"
          secondaryButtonText="Cancel"
          onRequestSubmit={discharge}
          onRequestClose={() => setDischarging(null)}
          size="sm"
          hasScrollingContent
        >
          <div className={styles.stack}>
            <Field label="How did it end?" value={outcome} onChange={setOutcome} options={OUTCOMES} />
            {(outcome === 'referred' || outcome === 'sent_home') && (
              <Field
                label={outcome === 'referred' ? 'Referred to' : 'Collected by'}
                value={referredTo}
                onChange={setReferredTo}
                placeholder={outcome === 'referred' ? 'Kampala Hospital' : 'Parent or guardian'}
              />
            )}
            <Field
              label="The parent has been told"
              value={parentInformed}
              onChange={v => setParentInformed(Boolean(v))}
              type="checkbox"
            />
            <Field label="Note" value={dischargeNote} onChange={setDischargeNote} type="textarea" />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SickBayTab;
