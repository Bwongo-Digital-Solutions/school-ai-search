import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, SelectItem, Tag } from '@carbon/react';
import { Add, Edit, TrashCan } from '@carbon/react/icons';
import { CardHeader, EmptyState, Field, TableSkeleton, WidgetCard } from '@/components/common';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { classOptionsFor, classLabel } from '@/lib/classLevels';
import {
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_LEVELS,
  requirementsApi,
  type RequirementItem,
  type RequirementLevel,
} from '@/lib/schoolLife';
import styles from '../tabs.module.scss';

interface Props {
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  canEdit: boolean;
}

const EMPTY = {
  itemName: '',
  level: 'primary' as RequirementLevel,
  gradeLevel: '' as string,
  category: 'cleaning',
  unit: '',
  quantity: '1',
  mandatory: true,
  boardingOnly: false,
  notes: '',
};

/**
 * The standing list a school publishes: what each level is asked to bring.
 *
 * Grouped by level rather than shown as one flat table, because the levels are the thing that
 * differs — a nursery list and a secondary boarding list have almost nothing in common, and seeing
 * them side by side is how somebody notices that one of them is wrong.
 */
const RequirementsTab: React.FC<Props> = ({ runAction, canEdit }) => {
  const { notify, confirm } = useNotifications();
  const { settings } = useSettings();

  const [items, setItems] = useState<RequirementItem[] | null>(null);
  const [levelFilter, setLevelFilter] = useState<RequirementLevel | ''>('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await requirementsApi.catalogue()).items);
    } catch (err) {
      console.error('Could not load the requirements catalogue:', err);
      setItems([]);
      notify.error('Could not load the requirements list', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  /** The catalogue split by level, in the order the levels are taught. */
  const grouped = useMemo(() => {
    const shown = (items || []).filter(item => !levelFilter || item.school_level === levelFilter);
    return REQUIREMENT_LEVELS
      .map(level => ({ ...level, items: shown.filter(item => item.school_level === level.value) }))
      .filter(group => group.items.length > 0);
  }, [items, levelFilter]);

  const openNew = () => {
    setForm({ ...EMPTY, level: (levelFilter || 'primary') as RequirementLevel });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (item: RequirementItem) => {
    setForm({
      itemName: item.item_name,
      level: item.school_level,
      gradeLevel: item.grade_level === null ? '' : String(item.grade_level),
      category: item.category,
      unit: item.unit,
      quantity: String(item.quantity),
      mandatory: item.mandatory,
      boardingOnly: item.boarding_only,
      notes: item.notes,
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const save = () =>
    runAction(editingId ? 'Updating the item' : 'Adding the item', async () => {
      if (!form.itemName.trim()) throw new Error('The item needs a name.');

      const payload = {
        itemName: form.itemName.trim(),
        level: form.level,
        // '' means the whole level, which is how most items are set.
        gradeLevel: form.gradeLevel === '' ? '' : Number(form.gradeLevel),
        category: form.category,
        unit: form.unit,
        quantity: Number(form.quantity) || 1,
        mandatory: form.mandatory,
        boardingOnly: form.boardingOnly,
        notes: form.notes,
      };

      if (editingId) await requirementsApi.updateItem(editingId, payload);
      else await requirementsApi.addItem(payload as never);

      notify.success(editingId ? 'Item updated' : `${payload.itemName} added`);
      setShowForm(false);
      await load();
    });

  const archive = (item: RequirementItem) =>
    runAction('Removing the item', async () => {
      const yes = await confirm({
        title: `Remove ${item.item_name}?`,
        message: 'It stops being asked for. What students have already brought stays on record.',
        confirmLabel: 'Remove',
      });
      if (!yes) return;

      await requirementsApi.archiveItem(item.id);
      notify.success(`${item.item_name} removed`);
      await load();
    });

  /* Classes for the picker come from the level being edited, not from the school's own setting: an
     item is being written for primary or for secondary, and the picker must offer that level's
     classes even at a school configured as the other. */
  const classOptions = useMemo(() => {
    const forLevel = { kindergarten: 'kindergarten', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary' } as const;
    return [
      { value: '', label: 'Every class at this level' },
      ...classOptionsFor(forLevel[form.level]).map(option => ({
        value: String(option.value),
        label: option.label,
      })),
    ];
  }, [form.level]);

  return (
    <div className={styles.stack}>
      <WidgetCard>
        <CardHeader title="What students are asked to bring">
          <Select
            id="requirement-level-filter"
            labelText="Level"
            hideLabel
            size="sm"
            className={styles.filter}
            value={levelFilter}
            onChange={event => setLevelFilter(event.target.value as RequirementLevel | '')}
          >
            <SelectItem value="" text="Every level" />
            {REQUIREMENT_LEVELS.map(level => (
              <SelectItem key={level.value} value={level.value} text={level.label} />
            ))}
          </Select>
          {canEdit && (
            <Button kind="ghost" size="sm" renderIcon={Add} onClick={openNew}>
              Add an item
            </Button>
          )}
        </CardHeader>

        {items === null ? (
          <TableSkeleton rowCount={8} columnLabels={['Item', 'For', 'Quantity', 'Category', ...(canEdit ? [''] : [])]} />
        ) : grouped.length === 0 ? (
          <EmptyState
            headerTitle="Requirements"
            displayText="items"
            helperText="Add what each level is asked to bring — brooms, toilet paper, reams of paper — and the list appears at registration."
            actionText={canEdit ? 'Add an item' : undefined}
            onAction={canEdit ? openNew : undefined}
          />
        ) : (
          grouped.map(group => (
            <div key={group.value}>
              <div className={styles.sectionRow}>
                <p className={styles.label}>
                  {group.label} · {group.grades}
                </p>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>For</th>
                      <th className={styles.numeric}>Quantity</th>
                      <th>Category</th>
                      {canEdit && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(item => (
                      <tr key={item.id}>
                        <td>
                          <p className={styles.primary}>{item.item_name}</p>
                          {item.notes && <p className={styles.secondary}>{item.notes}</p>}
                        </td>
                        <td>
                          {item.grade_level === null
                            ? <span className={styles.muted}>Whole level</span>
                            : classLabel(settings.school_level, item.grade_level)}
                          {item.boarding_only && (
                            <>
                              {' '}
                              <Tag type="teal" size="sm">Boarders</Tag>
                            </>
                          )}
                          {!item.mandatory && (
                            <>
                              {' '}
                              <Tag type="gray" size="sm">Optional</Tag>
                            </>
                          )}
                        </td>
                        <td className={styles.numeric}>
                          {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                        </td>
                        <td>{REQUIREMENT_CATEGORIES.find(c => c.value === item.category)?.label || item.category}</td>
                        {canEdit && (
                          <td>
                            <div className={styles.actions}>
                              <Button
                                kind="ghost" size="sm" hasIconOnly renderIcon={Edit}
                                iconDescription={`Edit ${item.item_name}`}
                                onClick={() => openEdit(item)}
                              />
                              <Button
                                kind="ghost" size="sm" hasIconOnly renderIcon={TrashCan}
                                iconDescription={`Remove ${item.item_name}`}
                                onClick={() => archive(item)}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </WidgetCard>

      {showForm && (
        <Modal
          open
          modalHeading={editingId ? 'Edit requirement' : 'Add a requirement'}
          primaryButtonText={editingId ? 'Save changes' : 'Add item'}
          secondaryButtonText="Cancel"
          onRequestSubmit={save}
          onRequestClose={() => setShowForm(false)}
          size="md"
          hasScrollingContent
        >
          <div className={styles.stack}>
            <Field label="Item" value={form.itemName} onChange={v => setForm(p => ({ ...p, itemName: v }))} placeholder="Broom" />

            <div className={styles.grid2}>
              <Field
                label="Level"
                value={form.level}
                onChange={v => setForm(p => ({ ...p, level: v as RequirementLevel, gradeLevel: '' }))}
                options={REQUIREMENT_LEVELS.map(l => ({ value: l.value, label: l.label }))}
                hint="Which students this is asked of."
              />
              <Field
                label="Class"
                value={form.gradeLevel}
                onChange={v => setForm(p => ({ ...p, gradeLevel: String(v) }))}
                options={classOptions}
                hint="Narrow it to one class, or leave it for the whole level."
              />
            </div>

            <div className={styles.grid3}>
              <Field label="Quantity" value={form.quantity} onChange={v => setForm(p => ({ ...p, quantity: String(v) }))} type="number" min={1} />
              <Field label="Unit" value={form.unit} onChange={v => setForm(p => ({ ...p, unit: v }))} placeholder="rolls, reams, piece" />
              <Field
                label="Category"
                value={form.category}
                onChange={v => setForm(p => ({ ...p, category: v }))}
                options={REQUIREMENT_CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
              />
            </div>

            <Field
              label="Required"
              value={form.mandatory}
              onChange={v => setForm(p => ({ ...p, mandatory: Boolean(v) }))}
              type="checkbox"
              hint="Only required items count towards a student owing something."
            />
            <Field
              label="Boarders only"
              value={form.boardingOnly}
              onChange={v => setForm(p => ({ ...p, boardingOnly: Boolean(v) }))}
              type="checkbox"
              hint="Bedding and buckets. A day student is never asked for these."
            />
            <Field label="Note" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Candidate class only" />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default RequirementsTab;
