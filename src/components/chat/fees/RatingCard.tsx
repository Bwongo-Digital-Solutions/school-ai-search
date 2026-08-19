import React, { useState } from 'react';
import { AlertCircle, Gauge, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { callFees } from '@/lib/fees';
import { formatDate } from '@/lib/format';
import Field from '@/components/common/Field';
import ModalShell from '@/components/common/ModalShell';
import type { EffectiveStanding, StudentIdentity } from '@/types/feeAdmin';
import { Panel, PrimaryButton, SecondaryButton, StandingBadge, STANDING_OPTIONS } from './shared';

const GRADE_TONE: Record<string, string> = {
  A: 'text-emerald-500',
  B: 'text-teal-500',
  C: 'text-amber-500',
  D: 'text-orange-500',
  E: 'text-red-500',
};

/**
 * Shows the effective standing alongside the computed rating that it may be overriding.
 * The computed figure stays on screen even when an override is active, so whoever reviews the
 * override can see what the payment history actually says.
 */
const RatingCard = ({
  student,
  rating,
  runAction,
  onChanged,
  compact = false,
}: {
  student: StudentIdentity;
  rating: EffectiveStanding;
  runAction: (label: string, handler: () => Promise<void>) => Promise<void>;
  onChanged: () => void | Promise<void>;
  compact?: boolean;
}) => {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [standing, setStanding] = useState(rating.override?.standing || 'watch');
  const [note, setNote] = useState(rating.override?.note || '');
  const [reviewDate, setReviewDate] = useState(rating.override?.review_date || '');

  const { computed } = rating;

  const save = () =>
    runAction('Setting fee standing', async () => {
      await callFees('set_standing', {
        studentId: student.student_id,
        standing,
        note,
        reviewDate: reviewDate || undefined,
      }, user);
      setEditing(false);
      await onChanged();
    });

  const clear = () =>
    runAction('Clearing fee standing', async () => {
      await callFees('clear_standing', { studentId: student.student_id }, user);
      await onChanged();
    });

  return (
    <Panel className={compact ? 'p-3' : 'p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Payment rating</h4>
            <StandingBadge standing={rating.standing} source={rating.source} />
          </div>

          {computed.score === null ? (
            <p className="text-xs text-gray-400 mt-2">
              No billing history has come due yet, so there is nothing to rate.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-4 mt-2">
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${GRADE_TONE[computed.grade || 'E']}`}>{computed.grade}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">{computed.score}/100</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                  {computed.confidence} confidence
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <p>
                  On time {computed.metrics.onTimeCount} of{' '}
                  {computed.metrics.onTimeCount + computed.metrics.lateCount}
                  {computed.metrics.avgDaysLate > 0 && ` · avg ${computed.metrics.avgDaysLate} days late`}
                </p>
                <p>
                  Penalties — punctuality {computed.penalties.punctuality}, exposure {computed.penalties.exposure},
                  overdue {computed.penalties.delinquency}
                </p>
              </div>
            </div>
          )}

          {rating.source === 'manual' && rating.override && (
            <div className="mt-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2">
              <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin override in effect — the computed rating above is shown for reference only
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">{rating.override.note}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Set by {rating.override.set_by || 'an admin'}
                {rating.override.review_date && ` · review ${formatDate(rating.override.review_date)}`}
              </p>
              {rating.override.review_due && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> This override is due for review.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => {
            setStanding(rating.override?.standing || 'watch');
            setNote(rating.override?.note || '');
            setReviewDate(rating.override?.review_date || '');
            setEditing(true);
          }}>
            {rating.source === 'manual' ? 'Edit override' : 'Set standing'}
          </SecondaryButton>
          {rating.source === 'manual' && (
            <SecondaryButton onClick={clear}>
              <RotateCcw className="w-3.5 h-3.5" /> Clear
            </SecondaryButton>
          )}
        </div>
      </div>

      {editing && (
        <ModalShell
          title="Set fee standing"
          subtitle={`${student.full_name} · ${student.student_number}`}
          icon={ShieldCheck}
          onClose={() => setEditing(false)}
          footer={
            <>
              <SecondaryButton onClick={() => setEditing(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={save} disabled={!note.trim()}>Save override</PrimaryButton>
            </>
          }
        >
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            An override replaces the computed rating everywhere it is shown. It stays in force until an admin clears
            it — a review date only flags it for attention, it never expires on its own.
          </p>
          <div className="space-y-3">
            <Field
              label="Standing"
              value={standing}
              onChange={value => setStanding(value as typeof standing)}
              options={STANDING_OPTIONS}
            />
            <Field
              label="Reason"
              type="textarea"
              value={note}
              onChange={value => setNote(String(value))}
              placeholder="e.g. Guardian is on an agreed payment schedule until end of Term 2"
              hint="Required — whoever reviews this later needs to know why it was set."
            />
            <Field label="Review on" type="date" value={reviewDate} onChange={value => setReviewDate(String(value))} />
          </div>
        </ModalShell>
      )}
    </Panel>
  );
};

export default RatingCard;
