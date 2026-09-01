import React, { useId, useRef } from 'react';
import { Button } from '@carbon/react';
import { Image as ImageIcon, TrashCan, Upload } from '@carbon/react/icons';
import styles from './pickers.module.scss';
import { useNotifications } from '@/contexts/NotificationContext';

interface ImagePickerProps {
  label: string;
  /** A data URI, or '' for none. */
  value: string;
  onChange: (dataUri: string) => void;
  /** 'logo' is square; 'photo' is portrait, matching where each ends up on a printed document. */
  shape?: 'logo' | 'photo';
  hint?: string;
  /** Rejects anything larger, in bytes. These are embedded in PDFs, so size matters. */
  maxBytes?: number;
}

const SIZES = {
  logo: { width: '3rem', height: '3rem' },
  photo: { width: '3rem', height: '3.75rem' },
};

/**
 * A picture, chosen from the device and held as a data URI.
 *
 * Used for the school's logo and for a student's photograph, both of which end up embedded in
 * generated PDFs rather than uploaded anywhere — which is why the value is a data URI and why the
 * size cap is enforced here, before a 6MB camera JPEG makes a report card that will not send.
 */
export const ImagePicker: React.FC<ImagePickerProps> = ({
  label,
  value,
  onChange,
  shape = 'logo',
  hint,
  maxBytes = 1_500_000,
}) => {
  const id = useId();
  const { notify } = useNotifications();
  const inputRef = useRef<HTMLInputElement>(null);
  const size = SIZES[shape];

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > maxBytes) {
      notify.warning(
        'That image is too large',
        `It is ${(file.size / 1_000_000).toFixed(1)}MB. Use one under ${(
          maxBytes / 1_000_000
        ).toFixed(1)}MB — it has to fit inside the generated PDF.`,
      );
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = '';
  };

  return (
    <div>
      <span className={styles.label}>{label}</span>
      <div className={styles.row}>
        {value ? (
          <img
            src={value}
            alt={`${label} preview`}
            className={`${styles.preview} ${shape === 'photo' ? styles.previewPhoto : ''}`}
            style={size}
          />
        ) : (
          <div className={styles.placeholder} style={size}>
            <ImageIcon size={20} />
          </div>
        )}

        <div className={styles.buttons}>
          <Button kind="tertiary" size="sm" renderIcon={Upload} onClick={() => inputRef.current?.click()}>
            {value ? 'Change' : 'Upload'}
          </Button>
          {value && (
            <Button kind="danger--ghost" size="sm" renderIcon={TrashCan} onClick={() => onChange('')}>
              Remove
            </Button>
          )}
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept="image/png,image/jpeg"
            className={styles.fileInput}
            onChange={handleFile}
          />
        </div>
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
};

export default ImagePicker;
