import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldAlert, TrendingUp } from 'lucide-react';
import type { AgingBucketKey, EffectiveFeeStanding } from '@/types/feeAdmin';

export const STANDING_STYLES: Record<
  EffectiveFeeStanding,
  { label: string; badge: string; icon: React.ElementType }
> = {
  excellent: {
    label: 'Excellent',
    badge: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2,
  },
  good: {
    label: 'Good',
    badge: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800',
    icon: TrendingUp,
  },
  fair: {
    label: 'Fair',
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    icon: Clock,
  },
  watch: {
    label: 'Watch',
    badge: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    icon: AlertTriangle,
  },
  delinquent: {
    label: 'Delinquent',
    badge: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
    icon: ShieldAlert,
  },
  unrated: {
    label: 'Unrated',
    badge: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    icon: HelpCircle,
  },
};

export const STANDING_OPTIONS = (['excellent', 'good', 'fair', 'watch', 'delinquent'] as const).map(
  standing => ({ value: standing, label: STANDING_STYLES[standing].label }),
);

export const AGING_COLUMNS: { key: AgingBucketKey; label: string; tone: string }[] = [
  { key: 'current', label: 'Not yet due', tone: 'text-gray-600 dark:text-gray-300' },
  { key: 'days_1_30', label: '1–30 days', tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'days_31_60', label: '31–60 days', tone: 'text-orange-600 dark:text-orange-400' },
  { key: 'days_61_90', label: '61–90 days', tone: 'text-red-500' },
  { key: 'days_90_plus', label: '90+ days', tone: 'text-red-600 dark:text-red-400 font-semibold' },
];

export const StandingBadge = ({ standing, source }: { standing: EffectiveFeeStanding; source?: string }) => {
  const style = STANDING_STYLES[standing] ?? STANDING_STYLES.unrated;
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.badge}`}>
      <Icon className="w-2.5 h-2.5" />
      {style.label}
      {source === 'manual' && <span className="opacity-70">· set by admin</span>}
    </span>
  );
};

export const PrimaryButton = ({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton = ({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);

export const Panel = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg ${className}`}>
    {children}
  </div>
);

export const EmptyState = ({ message }: { message: string }) => (
  <p className="px-4 py-10 text-center text-sm text-gray-400">{message}</p>
);

export const zebra = 'odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-800 dark:even:bg-gray-900/30';
