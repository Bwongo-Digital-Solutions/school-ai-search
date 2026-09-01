import React from 'react';
import { Modal } from '@carbon/react';
import styles from './modal-shell.module.scss';

type Width = 'max-w-sm' | 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl' | 'max-w-3xl' | string;

/** The old Tailwind width classes, mapped onto Carbon's four modal sizes. */
const SIZES: Record<string, 'xs' | 'sm' | 'md' | 'lg'> = {
  'max-w-sm': 'xs',
  'max-w-md': 'sm',
  'max-w-lg': 'sm',
  'max-w-xl': 'md',
  'max-w-2xl': 'md',
  'max-w-3xl': 'lg',
  'max-w-4xl': 'lg',
};

/**
 * The dialog used across the chat screens.
 *
 * Carbon's `Modal` underneath, which brings the things a hand-rolled overlay has to get right and
 * usually does not: a focus trap, Escape to close, `aria-modal`, and returning focus to whatever
 * opened it. The `footer` slot keeps working for the callers that pass their own buttons — Carbon's
 * `passiveModal` turns off its built-in button row so ours is the only one.
 */
const ModalShell = ({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: Width;
}) => (
  <Modal
    open
    passiveModal
    modalHeading={
      Icon ? (
        <span className={styles.heading}>
          <Icon size={16} />
          {title}
        </span>
      ) : (
        title
      )
    }
    modalLabel={subtitle}
    onRequestClose={onClose}
    size={SIZES[width] ?? 'sm'}
    className={styles.modal}
  >
    <div className={styles.body}>{children}</div>
    {footer && <div className={styles.footer}>{footer}</div>}
  </Modal>
);

export default ModalShell;
