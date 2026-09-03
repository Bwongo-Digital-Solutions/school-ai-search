import React, { useCallback, useEffect, useState } from 'react';
import { Button, Select, SelectItem, Tag } from '@carbon/react';
import { CheckmarkFilled, Renew } from '@carbon/react/icons';
import { CardHeader, EmptyState, TableSkeleton, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useChatContext } from '@/contexts/ChatContext';
import { classAndSection, classFilterOptions } from '@/lib/classLevels';
import { requirementsApi, type OwingStudent } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
}

/**
 * Who still owes something.
 *
 * The server derives this from the catalogue rather than from rows somebody assigned, so a student
 * enrolled before any of this existed reads as owing their level's list rather than as owing
 * nothing. That is the difference between a screen the school can act on in its first week and one
 * that stays empty until every record has been touched by hand.
 */
const OutstandingTab: React.FC<Props> = ({ runAction }) => {
  const { notify } = useNotifications();
  const { settings } = useSettings();
  const { students } = useChatContext();

  const [rows, setRows] = useState<OwingStudent[] | null>(null);
  const [term, setTerm] = useState('');
  const [grade, setGrade] = useState<string>('');
  const [section, setSection] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await requirementsApi.outstanding({
        gradeLevel: grade === '' ? '' : Number(grade),
        classSection: section,
      });
      setRows(result.students);
      setTerm(`${result.term} · ${result.academic_year}`);
    } catch (err) {
      console.error('Could not load outstanding requirements:', err);
      setRows([]);
      notify.error('Could not load the list', err instanceof Error ? err.message : undefined);
    }
  }, [grade, section, notify]);

  useEffect(() => { load(); }, [load]);

  /** Marks every item a student still owes as brought, which is what a full delivery means. */
  const settleAll = (student: OwingStudent) =>
    runAction(`Recording ${student.full_name}'s items`, async () => {
      for (const item of student.item_list) {
        await requirementsApi.record(student.id, item.requirement_id, 'brought');
      }
      notify.success(`${student.full_name} is settled`, `${student.owing} item${student.owing === 1 ? '' : 's'} recorded`);
      await load();
    });

  const classOptions = classFilterOptions(settings.school_level, students.map(s => s.grade_level));

  return (
    <WidgetCard>
      <CardHeader title={term ? `Still owing — ${term}` : 'Still owing'}>
        <Select
          id="owing-class" labelText="Class" hideLabel size="sm" className={styles.filter}
          value={grade} onChange={event => setGrade(event.target.value)}
        >
          <SelectItem value="" text="Every class" />
          {classOptions.map(option => (
            <SelectItem key={option.value} value={String(option.value)} text={option.label} />
          ))}
        </Select>
        <Select
          id="owing-section" labelText="Section" hideLabel size="sm" className={styles.filter}
          value={section} onChange={event => setSection(event.target.value)}
        >
          <SelectItem value="" text="Every section" />
          {['A', 'B', 'C', 'D'].map(name => (
            <SelectItem key={name} value={name} text={`Section ${name}`} />
          ))}
        </Select>
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>
          Refresh
        </Button>
      </CardHeader>

      {rows === null ? (
        <TableSkeleton rowCount={8} columnLabels={['Student', 'Class', 'Still to bring', 'Items', '']} />
      ) : rows.length === 0 ? (
        <EmptyState
          headerTitle="Still owing"
          displayText="students owing anything"
          helperText="Everybody in this class has brought what was asked of them."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
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
                  <td>
                    {classAndSection(settings.school_level, student.grade_level, student.class_section)}
                    {student.boarder && (
                      <>
                        {' '}
                        <Tag type="teal" size="sm">Boarder</Tag>
                      </>
                    )}
                  </td>
                  <td className={styles.truncate} title={student.items}>{student.items}</td>
                  <td className={styles.numeric}>{student.owing}</td>
                  <td>
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={CheckmarkFilled}
                      onClick={() => settleAll(student)}
                    >
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

export default OutstandingTab;
