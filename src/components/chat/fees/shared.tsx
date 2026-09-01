import React from 'react';
import { Button, Tag } from '@carbon/react';
import {
  Checkmark,
  CheckmarkFilled,
  Time,
  Warning,
  WarningAlt,
  Help,
} from '@carbon/react/icons';
import type { AgingBucketKey, EffectiveFeeStanding } from '@/types/feeAdmin';
import styles from './shared.module.scss';

/**
 * The pieces every fees tab shares.
 *
 * Carbon components underneath, so a fee standing reads like a status anywhere else in the app and
 * a button here behaves like a button there. The one thing written by hand is the ageing tone: how
 * overdue a debt is has to be visible before the number is read, and Carbon has no token for that.
 */

// Carbon types Tag as a union of several tag flavours, so the colour prop cannot be read off the
// component's props. The list is stable and documented, so it is named here.
type TagType =
  | 'red' | 'magenta' | 'purple' | 'blue' | 'cyan' | 'teal'
  | 'green' | 'gray' | 'cool-gray' | 'warm-gray' | 'high-contrast' | 'outline';

export const STANDING_STYLES: Record<
  EffectiveFeeStanding,
  { label: string; tag: TagType; icon: React.ElementType }
> = {
  excellent: { label: 'Excellent', tag: 'green', icon: CheckmarkFilled },
  good: { label: 'Good', tag: 'teal', icon: Checkmark },
  fair: { label: 'Fair', tag: 'cyan', icon: Time },
  watch: { label: 'Watch', tag: 'magenta', icon: WarningAlt },
  delinquent: { label: 'Delinquent', tag: 'red', icon: Warning },
  unrated: { label: 'Unrated', tag: 'cool-gray', icon: Help },
};

export const STANDING_OPTIONS = (['excellent', 'good', 'fair', 'watch', 'delinquent'] as const).map(
  standing => ({ value: standing, label: STANDING_STYLES[standing].label }),
);

export const AGING_COLUMNS: { key: AgingBucketKey; label: string; tone: string }[] = [
  { key: 'current', label: 'Not yet due', tone: styles.ageCurrent },
  { key: 'days_1_30', label: '1–30 days', tone: styles.ageWarn },
  { key: 'days_31_60', label: '31–60 days', tone: styles.ageHot },
  { key: 'days_61_90', label: '61–90 days', tone: styles.ageOverdue },
  { key: 'days_90_plus', label: '90+ days', tone: styles.ageCritical },
];

export const StandingBadge = ({ standing, source }: { standing: EffectiveFeeStanding; source?: string }) => {
  const style = STANDING_STYLES[standing] ?? STANDING_STYLES.unrated;
  return (
    <Tag type={style.tag} size="sm" renderIcon={style.icon}>
      {style.label}
      {source === 'manual' && <span className={styles.standingSource}> · set by admin</span>}
    </Tag>
  );
};

export const PrimaryButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button kind="primary" size="sm" className={className} {...props}>
    {children}
  </Button>
);

export const SecondaryButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button kind="tertiary" size="sm" className={className} {...props}>
    {children}
  </Button>
);

/** A destructive action — deleting a bursary, voiding a payment. */
export const DangerButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button kind="danger--ghost" size="sm" className={className} {...props}>
    {children}
  </Button>
);

/** A quiet action that sits inside a row — edit, retire, view. */
export const GhostButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button kind="ghost" size="sm" className={className} {...props}>
    {children}
  </Button>
);

export const Panel = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`${styles.panel} ${className}`}>{children}</div>
);

export const EmptyState = ({ message }: { message: string }) => (
  <p className={styles.empty}>{message}</p>
);

/** Applied to a row in a hand-built list to get Carbon's alternating shading. */
export const zebra = styles.zebra;
