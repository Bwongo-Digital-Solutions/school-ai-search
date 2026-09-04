import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, SelectItem, Tag } from '@carbon/react';
import { Renew } from '@carbon/react/icons';
import { CardHeader, EmptyState, TableSkeleton, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classAndSection } from '@/lib/classLevels';
import { matronApi, type DormRollEntry, type RollStatus } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  date: string;
  check: 'morning' | 'night';
  onChanged: () => void;
}

/**
 * The four answers, and why there are four rather than two.
 *
 * A child in the sick bay and a child nobody can find are both "not in bed", and a roll that
 * recorded them the same way would turn every sick child into a missing person at ten at night.
 * 'away' is the one the office signed out.
 */
const ANSWERS: { value: RollStatus; label: string; kind: 'primary' | 'tertiary' | 'danger--ghost' }[] = [
  { value: 'present', label: 'Present', kind: 'primary' },
  { value: 'sick_bay', label: 'Sick bay', kind: 'tertiary' },
  { value: 'away', label: 'Away', kind: 'tertiary' },
  { value: 'absent', label: 'Absent', kind: 'danger--ghost' },
];

const TONE: Record<RollStatus, 'green' | 'red' | 'purple' | 'blue'> = {
  present: 'green',
  absent: 'red',
  sick_bay: 'purple',
  away: 'blue',
};

const LABEL: Record<RollStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  sick_bay: 'Sick bay',
  away: 'Away',
};

const DormRollTab: React.FC<Props> = ({ runAction, date, check, onChanged }) => {
  const { notify } = useNotifications();
  const { settings } = useSettings();

  const [rows, setRows] = useState<DormRollEntry[] | null>(null);
  const [hostel, setHostel] = useState('');

  const load = useCallback(async () => {
    try {
      setRows((await matronApi.dormRoll(date, check, hostel)).students);
    } catch (err) {
      console.error('Could not load the dormitory roll:', err);
      setRows([]);
      notify.error('Could not load the roll', err instanceof Error ? err.message : undefined);
    }
  }, [date, check, hostel, notify]);

  useEffect(() => { load(); }, [load]);

  const hostels = useMemo(
    () => [...new Set((rows || []).map(row => row.hostel_name))].sort(),
    [rows],
  );

  const mark = (entry: DormRollEntry, status: RollStatus) =>
    runAction(`Marking ${entry.full_name}`, async () => {
      await matronApi.mark(entry.id, status, { date, check });
      /* Refetched rather than patched in place: the roll should be what the server says it is, not
         what this screen believes it just did. */
      await load();
      onChanged();
    });

  const unmarked = (rows || []).filter(row => !row.status).length;

  return (
    <WidgetCard>
      <CardHeader title={`Roll call — ${check === 'night' ? 'night' : 'morning'}, ${date}`}>
        {hostels.length > 1 && (
          <Select
            id="roll-hostel" labelText="Hostel" hideLabel size="sm" className={styles.filter}
            value={hostel} onChange={event => setHostel(event.target.value)}
          >
            <SelectItem value="" text="Every hostel" />
            {hostels.map(name => <SelectItem key={name} value={name} text={name} />)}
          </Select>
        )}
        {unmarked > 0 && <Tag type="gray" size="sm">{unmarked} not yet marked</Tag>}
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>Refresh</Button>
      </CardHeader>

      {rows === null ? (
        <TableSkeleton rowCount={8} columnLabels={['Student', 'Bed', 'Class', 'Tonight', '']} />
      ) : rows.length === 0 ? (
        <EmptyState
          headerTitle="Roll call"
          displayText="boarders"
          helperText="Nobody has been given a bed yet. Allocate beds under Beds, and they appear here."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Bed</th>
                <th>Class</th>
                <th>Tonight</th>
                <th aria-label="Mark" />
              </tr>
            </thead>
            <tbody>
              {rows.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <p className={styles.primary}>{entry.full_name}</p>
                    <p className={styles.secondary}>{entry.student_number}</p>
                  </td>
                  <td>
                    {entry.hostel_name} {entry.room_number}
                    {entry.bed_number && <p className={styles.secondary}>Bed {entry.bed_number}</p>}
                  </td>
                  <td>{classAndSection(settings.school_level, entry.grade_level, entry.class_section)}</td>
                  <td>
                    {entry.status
                      ? <Tag type={TONE[entry.status]} size="sm">{LABEL[entry.status]}</Tag>
                      : <span className={styles.muted}>Not marked</span>}
                    {/* Shown beside an unmarked name so nobody goes hunting a child the office
                        already signed out, or who is lying in the sick bay downstairs. */}
                    {!entry.status && entry.in_sick_bay && (
                      <p className={styles.secondary}>In the sick bay</p>
                    )}
                    {!entry.status && entry.signed_out && (
                      <p className={styles.secondary}>Signed out at the gate</p>
                    )}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {ANSWERS.map(answer => (
                        <Button
                          key={answer.value}
                          kind={entry.status === answer.value ? 'primary' : 'ghost'}
                          size="sm"
                          onClick={() => mark(entry, answer.value)}
                        >
                          {answer.label}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetCard>
  );
};

export default DormRollTab;
