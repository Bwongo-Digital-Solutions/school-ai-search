import React, { useId } from 'react';
import { TextInput } from '@carbon/react';
import styles from './pickers.module.scss';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  hint?: string;
}

/**
 * A colour, as a swatch and as a hex value.
 *
 * Both, because people arrive with one or the other: a head teacher picks from the swatch, and
 * whoever was given the school's brand guide pastes `#2952a3`.
 */
export const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange, hint }) => {
  const id = useId();

  return (
    <div>
      <span className={styles.label}>{label}</span>
      <div className={styles.colourRow}>
        <input
          type="color"
          className={styles.swatch}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#2952a3'}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} swatch`}
        />
        <TextInput
          id={id}
          className={styles.hex}
          labelText={label}
          hideLabel
          size="md"
          placeholder="#2952a3"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
};

export default ColorPicker;
