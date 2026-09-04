import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tag } from '@carbon/react';
import { Add, Edit, Renew, TrashCan } from '@carbon/react/icons';
import { CardHeader, EmptyState, Field, StudentPicker, TableSkeleton, WidgetCard } from '@/components/common';
import { useChatContext } from '@/contexts/ChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { matronApi, type HostelRoom, type RoomOccupant } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}

/**
 * The room form's state.
 *
 * `capacity` carries `''` as well as a number because the field starts blank and a matron part-way
 * through clearing it has typed nothing, not zero — and `Number('')` is 0, which would otherwise
 * read as a room with no beds.
 */
interface RoomDraft {
  roomId?: string;
  hostelName: string;
  roomNumber: string;
  capacity: number | '';
}

const emptyDraft: RoomDraft = { hostelName: '', roomNumber: '', capacity: '' };

const nameOf = (occupant: RoomOccupant) => `${occupant.first_name} ${occupant.last_name}`.trim();

/**
 * Who sleeps where.
 *
 * The matron keeps this list herself. She is the person standing in the room who knows it holds six
 * beds and not four, and the round trip through the office to correct that was long enough that the
 * list simply went stale.
 *
 * The occupants are shown under each room rather than counted, because the count answers a question
 * nobody asks. "Nile House 12 is full" is not useful on its own; "Nile House 12 is full, and these
 * are the four children in it" is what lets her move one.
 *
 * A full room is refused by the server in words rather than overfilled, capacity cannot be cut below
 * the children already in it, and a room is not removable while anyone still sleeps there — the
 * assignments cascade, so deleting an occupied room would erase the record of who slept where.
 */
const BedsTab: React.FC<Props> = ({ runAction, onChanged }) => {
  const { notify } = useNotifications();
  const { students } = useChatContext();

  const [rooms, setRooms] = useState<HostelRoom[] | null>(null);
  const [assigning, setAssigning] = useState<HostelRoom | null>(null);
  const [studentId, setStudentId] = useState('');
  const [bedNumber, setBedNumber] = useState('');

  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [removing, setRemoving] = useState<HostelRoom | null>(null);

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

  /* Taking a child out of a bed. The server ends whichever assignment is live, so this needs the
     student rather than the room — and the room list is the only place her name appears. */
  const moveOut = (room: HostelRoom, occupant: RoomOccupant) =>
    runAction('Moving the student out', async () => {
      await matronApi.releaseBed(occupant.student_number);
      notify.success(`${nameOf(occupant)} moved out of ${room.hostel_name} ${room.room_number}`);
      await load();
      onChanged();
    });

  const saveRoom = () =>
    runAction(draft?.roomId ? 'Saving the room' : 'Adding the room', async () => {
      if (!draft) return;
      if (!draft.hostelName.trim()) throw new Error('Which hostel?');
      if (!draft.roomNumber.trim()) throw new Error('Which room?');

      // Tested for emptiness before conversion: Number('') is 0, so a blank field would otherwise
      // ask the server for a room with no beds rather than saying nothing was typed.
      if (draft.capacity === '') throw new Error('How many beds?');
      const capacity = Number(draft.capacity);
      if (!Number.isInteger(capacity) || capacity < 1) throw new Error('How many beds? A whole number, at least one.');

      await matronApi.saveRoom({
        roomId: draft.roomId,
        hostelName: draft.hostelName.trim(),
        roomNumber: draft.roomNumber.trim(),
        capacity,
      });
      notify.success(draft.roomId ? 'Room saved' : `${draft.hostelName.trim()} ${draft.roomNumber.trim()} added`);

      setDraft(null);
      await load();
      onChanged();
    });

  const removeRoom = () =>
    runAction('Removing the room', async () => {
      if (!removing) return;
      await matronApi.removeRoom(removing.id);
      notify.success(`${removing.hostel_name} ${removing.room_number} removed`);
      setRemoving(null);
      await load();
      onChanged();
    });

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Dormitories">
          <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => setDraft({ ...emptyDraft })}>
            Add a room
          </Button>
          <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load}>Refresh</Button>
        </CardHeader>

        {rooms === null ? (
          <TableSkeleton rowCount={5} columnLabels={['Hostel', 'Room', 'Beds', 'Free', '']} />
        ) : rooms.length === 0 ? (
          <EmptyState
            headerTitle="Dormitories"
            displayText="rooms"
            helperText="No dormitory rooms have been set up yet. Add the first one with the button above."
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
                  <React.Fragment key={room.id}>
                    <tr>
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
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={`Edit ${room.hostel_name} ${room.room_number}`}
                          renderIcon={Edit}
                          onClick={() => setDraft({
                            roomId: room.id,
                            hostelName: room.hostel_name,
                            roomNumber: room.room_number,
                            capacity: room.capacity,
                          })}
                        />
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={`Remove ${room.hostel_name} ${room.room_number}`}
                          renderIcon={TrashCan}
                          disabled={room.occupied > 0}
                          onClick={() => setRemoving(room)}
                        />
                      </td>
                    </tr>

                    {/* The children in the room, under it. Without these the matron can see that a
                        room is full but not which child to move, which is the only thing she wants
                        to do standing in front of it. */}
                    {room.occupants.map(occupant => (
                      <tr key={occupant.assignment_id}>
                        <td />
                        <td colSpan={3}>
                          {nameOf(occupant)}
                          {' '}
                          <span className={styles.muted}>
                            {occupant.student_number}
                            {occupant.bed_number ? ` · bed ${occupant.bed_number}` : ''}
                          </span>
                        </td>
                        <td>
                          <Button kind="ghost" size="sm" onClick={() => moveOut(room, occupant)}>
                            Move out
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
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
            <StudentPicker value={studentId} onChange={setStudentId} students={students} label="Student" />
            <Field label="Bed number" value={bedNumber} onChange={setBedNumber} placeholder="3" />
            <p className={styles.noteRow}>
              A student who already has a bed elsewhere is moved, not duplicated.
            </p>
          </div>
        </Modal>
      )}

      {draft && (
        <Modal
          open
          modalHeading={draft.roomId ? 'Edit the room' : 'Add a room'}
          primaryButtonText={draft.roomId ? 'Save' : 'Add the room'}
          secondaryButtonText="Cancel"
          onRequestSubmit={saveRoom}
          onRequestClose={() => setDraft(null)}
          size="sm"
        >
          <div className={styles.stack}>
            <Field
              label="Hostel"
              value={draft.hostelName}
              onChange={value => setDraft({ ...draft, hostelName: value })}
              placeholder="Nile House"
            />
            <Field
              label="Room number"
              value={draft.roomNumber}
              onChange={value => setDraft({ ...draft, roomNumber: value })}
              placeholder="12"
            />
            <Field
              label="Beds"
              type="number"
              min={1}
              value={draft.capacity}
              onChange={value => setDraft({ ...draft, capacity: value })}
              placeholder="6"
            />
            {draft.roomId && (
              <p className={styles.noteRow}>
                The bed count cannot go below the children already sleeping here. Move them first.
              </p>
            )}
          </div>
        </Modal>
      )}

      {removing && (
        <Modal
          open
          danger
          modalHeading={`Remove ${removing.hostel_name} ${removing.room_number}?`}
          primaryButtonText="Remove it"
          secondaryButtonText="Keep it"
          onRequestSubmit={removeRoom}
          onRequestClose={() => setRemoving(null)}
          size="sm"
        >
          <p>
            The room is empty, so nobody is moved. It disappears from the dormitory list and from the
            roll call.
          </p>
        </Modal>
      )}
    </div>
  );
};

export default BedsTab;
