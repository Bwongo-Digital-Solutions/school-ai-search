import React from 'react';

/** Small labelled metric card, matching the tiles on the fee status and records screens. */
const StatTile = ({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) => {
  const iconTone = {
    default: 'text-indigo-500',
    warning: 'text-amber-500',
    danger: 'text-red-500',
    success: 'text-emerald-500',
  }[tone];

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Icon className={`w-3.5 h-3.5 ${iconTone}`} />
        {label}
      </div>
      <p className="text-lg font-bold text-gray-800 dark:text-white mt-1">{value}</p>
    </div>
  );
};

export default StatTile;
