import React from 'react';

export type FieldValue = string | number | boolean | null | undefined;

/**
 * The form primitive used across the records and fees screens: a labelled input, select or
 * textarea driven by a plain useState object, with an optional inline error.
 */
const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  options,
  min,
  max,
  step,
  placeholder,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  type?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}) => {
  const base = `w-full bg-gray-50 dark:bg-gray-700 border rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-60 ${
    error
      ? 'border-red-400 focus:border-red-500'
      : 'border-gray-200 dark:border-gray-600 focus:border-indigo-400'
  }`;

  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</span>
      {options ? (
        <select
          value={String(value ?? '')}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          className={base}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          value={String(value ?? '')}
          disabled={disabled}
          placeholder={placeholder}
          onChange={event => onChange(event.target.value)}
          rows={3}
          className={`${base} resize-none`}
        />
      ) : type === 'checkbox' ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
      ) : (
        <input
          type={type}
          value={String(value ?? '')}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={placeholder}
          onChange={event => onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
          className={base}
        />
      )}
      {error ? (
        <span className="block text-[11px] text-red-500 mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>
      ) : null}
    </label>
  );
};

export default Field;
