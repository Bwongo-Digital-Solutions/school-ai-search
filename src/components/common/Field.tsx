import React, { useId } from 'react';
import { Checkbox, NumberInput, Select, SelectItem, TextArea, TextInput } from '@carbon/react';
import { useResponsiveSize } from '@/hooks/useLayoutType';
import styles from './field.module.scss';

/** What a field can be given. Null and undefined stand for "not set yet". */
export type FieldValue = string | number | boolean | null | undefined;

/**
 * What a field hands back.
 *
 * Never null or undefined: an emptied text box gives '', an emptied number gives ''. Narrower than
 * FieldValue on purpose, so a caller can spread the result straight back into its form state
 * without widening every field on the object.
 */
export type FieldChange = string | number | boolean;

interface FieldProps<T extends FieldChange> {
  label: string;
  value: T | null | undefined;
  // NoInfer keeps T pinned to whatever `value` is. Without it a `Dispatch<SetStateAction<string>>`
  // passed straight in as onChange would widen T to include the updater-function form of
  // SetStateAction, and the value prop would then stop matching.
  onChange: (value: NoInfer<T>) => void;
  /** 'text' | 'number' | 'date' | 'email' | 'textarea' | 'checkbox' | any HTML input type. */
  type?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * The form primitive used across the records and fees screens.
 *
 * Generic over the value it carries, so `onChange` hands back the caller's own type and the result
 * can be spread straight into form state. The internal casts are the seam that makes that work:
 * which control renders is chosen by `type`, so it is the caller — not this component — that knows
 * a `type="number"` field belongs to a `number` slot. Pairing `type` with a mismatched value type is
 * the one thing this cannot catch, and the one thing that was silently broken before it was
 * generic: every call site widened its state to `string | number | boolean` and failed to compile.
 *
 * A thin shim over Carbon's own controls rather than a control of its own: Carbon already draws the
 * label, the helper text and the invalid state, and does it the same way on every screen. What this
 * adds is the plain `value`/`onChange` shape the surrounding forms are written against, so those
 * forms did not have to be rewritten to get Carbon's inputs.
 *
 * Sizes itself for touch on a tablet, like everything else.
 */
const Field = <T extends FieldChange>({
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
}: FieldProps<T>) => {
  const id = useId();
  const size = useResponsiveSize();

  const shared = {
    id,
    labelText: label,
    disabled,
    invalid: Boolean(error),
    invalidText: error,
    helperText: error ? undefined : hint,
  };

  if (options) {
    return (
      <div className={styles.field}>
        <Select
          {...shared}
          size={size}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} text={option.label} />
          ))}
        </Select>
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <div className={styles.field}>
        <TextArea
          {...shared}
          rows={3}
          placeholder={placeholder}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value as T)}
        />
      </div>
    );
  }

  if (type === 'checkbox') {
    return (
      <div className={`${styles.field} ${styles.checkbox}`}>
        <Checkbox
          id={id}
          labelText={label}
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(_event, { checked }) => onChange(checked as T)}
        />
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div className={styles.field}>
        <NumberInput
          {...shared}
          label={label}
          size={size}
          hideSteppers
          allowEmpty
          disableWheel
          min={min}
          max={max}
          step={step}
          value={value === null || value === undefined || value === '' ? '' : Number(value)}
          onChange={(event, state) => {
            const next =
              state?.value ?? (event?.target as HTMLInputElement | undefined)?.value ?? '';
            onChange((next === '' ? '' : Number(next)) as T);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <TextInput
        {...shared}
        type={type}
        size={size}
        placeholder={placeholder}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value as T)}
      />
    </div>
  );
};

export default Field;
