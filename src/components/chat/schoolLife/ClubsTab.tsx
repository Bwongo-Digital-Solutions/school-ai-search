import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tag } from '@carbon/react';
import { Add, Edit, Group, TrashCan, View } from '@carbon/react/icons';
import { CardHeader, EmptyState, Field, TableSkeleton, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classAndSection } from '@/lib/classLevels';
import { clubsApi, type Club, type ClubMember } from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  canEdit: boolean;
  onChanged?: () => void;
}

const EMPTY = {
  name: '',
  description: '',
  category: 'general',
  patronName: '',
  meetingDay: '',
  meetingTime: '',
  venue: '',
  capacity: '' as string,
};

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => ({
  value: day,
  label: day || 'Not set',
}));

/**
 * The clubs a school runs, and who is in them.
 *
 * The roster is opened per club rather than shown inline: a school has a dozen clubs and a football
 * team of thirty, and a page that unrolled all of them at once would answer no question well.
 */
const ClubsTab: React.FC<Props> = ({ runAction, canEdit, onChanged }) => {
  const { notify, confirm } = useNotifications();
  const { settings } = useSettings();

  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [rosterClub, setRosterClub] = useState<Club | null>(null);
  const [roster, setRoster] = useState<ClubMember[] | null>(null);

  const load = useCallback(async () => {
    try {
      setClubs((await clubsApi.list()).clubs);
    } catch (err) {
      console.error('Could not load clubs:', err);
      // An empty list and a failed one must not look the same, so the failure is said out loud.
      setClubs([]);
      notify.error('Could not load the clubs', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (club: Club) => {
    setForm({
      name: club.name,
      description: club.description,
      category: club.category,
      patronName: club.patron_name,
      meetingDay: club.meeting_day,
      meetingTime: club.meeting_time,
      venue: club.venue,
      capacity: club.capacity === null ? '' : String(club.capacity),
    });
    setEditingId(club.id);
    setShowForm(true);
  };

  const save = () =>
    runAction(editingId ? 'Updating the club' : 'Adding the club', async () => {
      if (!form.name.trim()) throw new Error('A club needs a name.');

      const payload = {
        name: form.name.trim(),
        description: form.description,
        category: form.category,
        patronName: form.patronName,
        meetingDay: form.meetingDay,
        meetingTime: form.meetingTime,
        venue: form.venue,
        // '' is "no limit", which is not the same as 0 — the server normalises either way.
        capacity: form.capacity === '' ? null : Number(form.capacity),
      };

      if (editingId) await clubsApi.update(editingId, payload as Partial<Club>);
      else await clubsApi.create(payload as Partial<Club> & { name: string });

      notify.success(editingId ? 'Club updated' : `${payload.name} added`);
      setShowForm(false);
      await load();
      onChanged?.();
    });

  const archive = (club: Club) =>
    runAction('Retiring the club', async () => {
      const yes = await confirm({
        title: `Retire ${club.name}?`,
        message: 'It stops being offered to new students. Everyone who was in it stays on record, '
          + 'so last year\'s roster is still there.',
        confirmLabel: 'Retire',
      });
      if (!yes) return;

      await clubsApi.archive(club.id);
      notify.success(`${club.name} retired`);
      await load();
      onChanged?.();
    });

  const openRoster = (club: Club) =>
    runAction('Loading the roster', async () => {
      setRosterClub(club);
      setRoster(null);
      setRoster((await clubsApi.roster(club.id)).members);
    });

  const removeMember = (member: ClubMember) =>
    runAction('Removing the member', async () => {
      if (!rosterClub) return;
      await clubsApi.leave(rosterClub.id, member.student_id);
      notify.success(`${member.full_name} left ${rosterClub.name}`);
      setRoster((await clubsApi.roster(rosterClub.id)).members);
      await load();
    });

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="Clubs and societies">
          {canEdit && (
            <Button kind="ghost" size="sm" renderIcon={Add} onClick={openNew}>
              Add a club
            </Button>
          )}
        </CardHeader>

        {clubs === null ? (
          <TableSkeleton rowCount={6} columnLabels={['Club', 'Patron', 'Meets', 'Members', '']} />
        ) : clubs.length === 0 ? (
          <EmptyState
            headerTitle="Clubs and societies"
            displayText="clubs"
            helperText="Add the clubs your school runs, and students can be allocated to them at registration."
            actionText={canEdit ? 'Add a club' : undefined}
            onAction={canEdit ? openNew : undefined}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Patron</th>
                  <th>Meets</th>
                  <th className={styles.numeric}>Members</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {clubs.map(club => (
                  <tr key={club.id}>
                    <td>
                      <p className={styles.primary}>{club.name}</p>
                      {club.description && <p className={styles.secondary}>{club.description}</p>}
                    </td>
                    <td>{club.patron_name || <span className={styles.muted}>Not named</span>}</td>
                    <td>
                      {club.meeting_day
                        ? `${club.meeting_day}${club.meeting_time ? ` · ${club.meeting_time}` : ''}`
                        : <span className={styles.muted}>—</span>}
                      {club.venue && <p className={styles.secondary}>{club.venue}</p>}
                    </td>
                    <td className={styles.numeric}>
                      {/* A club with no limit shows its count alone; a limit is shown as a ratio
                          because that is the number somebody at the desk is checking against. */}
                      {club.capacity ? `${club.member_count} / ${club.capacity}` : club.member_count}
                      {club.full && (
                        <>
                          {' '}
                          <Tag type="red" size="sm">Full</Tag>
                        </>
                      )}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={View}
                          iconDescription={`Who is in ${club.name}`}
                          onClick={() => openRoster(club)}
                        />
                        {canEdit && (
                          <>
                            <Button
                              kind="ghost"
                              size="sm"
                              hasIconOnly
                              renderIcon={Edit}
                              iconDescription={`Edit ${club.name}`}
                              onClick={() => openEdit(club)}
                            />
                            <Button
                              kind="ghost"
                              size="sm"
                              hasIconOnly
                              renderIcon={TrashCan}
                              iconDescription={`Retire ${club.name}`}
                              onClick={() => archive(club)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>

      {showForm && (
        <Modal
          open
          modalHeading={editingId ? 'Edit club' : 'Add a club'}
          primaryButtonText={editingId ? 'Save changes' : 'Add club'}
          secondaryButtonText="Cancel"
          onRequestSubmit={save}
          onRequestClose={() => setShowForm(false)}
          size="md"
          hasScrollingContent
        >
          <div className={styles.stack}>
            <div className={styles.grid2}>
              <Field label="Club name" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} />
              <Field
                label="Patron"
                value={form.patronName}
                onChange={v => setForm(p => ({ ...p, patronName: v }))}
                hint="The member of staff who runs it."
              />
            </div>
            <Field
              label="What the club does"
              value={form.description}
              onChange={v => setForm(p => ({ ...p, description: v }))}
              type="textarea"
            />
            <div className={styles.grid3}>
              <Field label="Meeting day" value={form.meetingDay} onChange={v => setForm(p => ({ ...p, meetingDay: v }))} options={DAYS} />
              <Field label="Time" value={form.meetingTime} onChange={v => setForm(p => ({ ...p, meetingTime: v }))} placeholder="4:00pm" />
              <Field label="Venue" value={form.venue} onChange={v => setForm(p => ({ ...p, venue: v }))} placeholder="Main hall" />
            </div>
            <Field
              label="Maximum members"
              value={form.capacity}
              onChange={v => setForm(p => ({ ...p, capacity: String(v) }))}
              type="number"
              min={0}
              hint="Leave blank for no limit. Once reached, the club stops accepting new members."
            />
          </div>
        </Modal>
      )}

      {rosterClub && (
        <Modal
          open
          passiveModal
          modalHeading={`${rosterClub.name} — who is in it`}
          modalLabel={rosterClub.patron_name ? `Patron: ${rosterClub.patron_name}` : 'Club roster'}
          onRequestClose={() => { setRosterClub(null); setRoster(null); }}
          size="md"
          hasScrollingContent
        >
          {roster === null ? (
            <TableSkeleton rowCount={5} columnLabels={['Student', 'Class', 'Joined', ...(canEdit ? [''] : [])]} />
          ) : roster.length === 0 ? (
            <p className={styles.empty}>Nobody has joined this club yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Joined</th>
                    {canEdit && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {roster.map(member => (
                    <tr key={member.id}>
                      <td>
                        <p className={styles.primary}>{member.full_name}</p>
                        <p className={styles.secondary}>{member.student_number}</p>
                      </td>
                      <td>{classAndSection(settings.school_level, member.grade_level, member.class_section)}</td>
                      <td>{member.joined_on}</td>
                      {canEdit && (
                        <td>
                          <Button kind="ghost" size="sm" onClick={() => removeMember(member)}>
                            Remove
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.noteRow}>
            <Group size={16} />
            Removing somebody records that they left. It does not erase that they were once a member.
          </p>
        </Modal>
      )}
    </div>
  );
};

export default ClubsTab;
