import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@carbon/react';
import { CheckmarkFilled, Renew } from '@carbon/react/icons';
import { CardHeader, EmptyState, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classAndSection } from '@/lib/classLevels';
import { matronApi, requirementsApi, type OwingStudent } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}

/**
 * The boarders who still owe something.
 *
 * The matron is usually the person who notices — she is the one looking at whether a bed has a
 * mosquito net over it — so this is the office's own outstanding list, narrowed to the students who
 * actually sleep here. It is derived the same way on the server, so the two screens cannot report
 * different answers to the same question.
 */
const WelfareTab: React.FC<Props> = ({ runAction, onChanged }) => {
  const { notify } = useNotifications();
  const { settings } = useSettings();

  const [rows, setRows] = useState<OwingStudent[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await matronApi.welfare()).students);
    } catch (err) {
      console.error('Could not load the welfare list:', err);
      setRows([]);
      notify.error('Could not load the list', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const settle = (student: OwingStudent) =>
    runAction(`Recording ${student.full_name}'s items`, async () => {
      for (const item of student.item_list) {
        await requirementsApi.record(student.id, item.requirement_id, 'brought');
      }
      notify.success(`${student.full_name} is settled`);
      await load();
      onChanged();
    });

  return (
    <WidgetCard>
      <CardHeader title="Boarders still to bring things">
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>Refresh</Button>
      </CardHeader>

      {rows === null ? (
        <p className={styles.loading}>Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          headerTitle="Welfare"
          displayText="boarders owing anything"
          helperText="Every boarder has brought what was asked of them."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Bed</th>
                <th>Class</th>
                <th>Still to bring</th>
                <th className={styles.numeric}>Items</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(student => (
                <tr key={student.id}>
                  <td>
                    <p className={styles.primary}>{student.full_name}</p>
                    <p className={styles.secondary}>{student.student_id}</p>
                  </td>
                  <td>{[student.hostel_name, student.room_number].filter(Boolean).join(' ')}</td>
                  <td>{classAndSection(settings.school_level, student.grade_level, student.class_section)}</td>
                  <td className={styles.truncate} title={student.items}>{student.items}</td>
                  <td className={styles.numeric}>{student.owing}</td>
                  <td>
                    <Button kind="ghost" size="sm" renderIcon={CheckmarkFilled} onClick={() => settle(student)}>
                      All brought
                    </Button>
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

export default WelfareTab;
