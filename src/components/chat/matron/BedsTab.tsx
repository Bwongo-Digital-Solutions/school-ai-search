import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tag } from '@carbon/react';
import { Add, Renew } from '@carbon/react/icons';
import { CardHeader, EmptyState, Field, StudentPicker, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { matronApi, type HostelRoom } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}

/**
 * Who sleeps where.
 *
 * A full room is refused by the server in words rather than overfilled, and giving a student a bed
 * ends whatever bed they had — a child sleeping in two rooms at once is not a state the roll call
 * can make sense of.
 */
const BedsTab: React.FC<Props> = ({ runAction, onChanged }) => {
  const { notify } = useNotifications();

  const [rooms, setRooms] = useState<HostelRoom[] | null>(null);
  const [assigning, setAssigning] = useState<HostelRoom | null>(null);
  const [studentId, setStudentId] = useState('');
  const [bedNumber, setBedNumber] = useState('');

  const load = useCallback(async () => {
    try {
      setRooms((await matronApi.rooms()).rooms);
    } catch (err) {
      console.error('Could not load the rooms:', err);
      setRooms([]);
      notify.error('Could not load the dormitories', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const assign = () =>
    runAction('Giving the student a bed', async () => {
      if (!assigning) return;
      if (!studentId) throw new Error('Choose the student.');

      const result = await matronApi.assignBed(studentId, assigning.id, bedNumber);
      if (result.already) notify.info('Already in that room');
      else notify.success(`Bed given in ${assigning.hostel_name} ${assigning.room_number}`);

      setAssigning(null);
      setStudentId(''); setBedNumber('');
      await load();
      onChanged();
    });

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Dormitories">
          <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>Refresh</Button>
        </CardHeader>

        {rooms === null ? (
          <p className={styles.loading}>Loading…</p>
        ) : rooms.length === 0 ? (
          <EmptyState
            headerTitle="Dormitories"
            displayText="rooms"
            helperText="No dormitory rooms have been set up yet. An administrator adds them under School Data."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Hostel</th>
                  <th>Room</th>
                  <th className={styles.numeric}>Beds</th>
                  <th className={styles.numeric}>Free</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rooms.map(room => (
                  <tr key={room.id}>
                    <td className={styles.primary}>{room.hostel_name}</td>
                    <td>{room.room_number}</td>
                    <td className={styles.numeric}>{room.occupied} / {room.capacity}</td>
                    <td className={styles.numeric}>
                      {room.full ? <Tag type="red" size="sm">Full</Tag> : room.free}
                    </td>
                    <td>
                      <Button
                        kind="ghost"
                        size="sm"
                        renderIcon={Add}
                        disabled={room.full}
                        onClick={() => setAssigning(room)}
                      >
                        Give a bed
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>

      {assigning && (
        <Modal
          open
          modalHeading={`A bed in ${assigning.hostel_name} ${assigning.room_number}`}
          modalLabel={`${assigning.free} of ${assigning.capacity} free`}
          primaryButtonText="Give the bed"
          secondaryButtonText="Cancel"
          onRequestSubmit={assign}
          onRequestClose={() => setAssigning(null)}
          size="sm"
          hasScrollingContent
        >
          <div className={styles.stack}>
            <StudentPicker value={studentId} onChange={setStudentId} label="Student" />
            <Field label="Bed number" value={bedNumber} onChange={setBedNumber} placeholder="3" />
            <p className={styles.noteRow}>
              A student who already has a bed elsewhere is moved, not duplicated.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default BedsTab;
