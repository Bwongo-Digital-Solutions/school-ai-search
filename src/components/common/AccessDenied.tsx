import React from 'react';
import { Locked } from '@carbon/react/icons';
import styles from './access-denied.module.scss';

interface AccessDeniedProps {
  title: string;
  /** Why this account cannot open the screen, and what it can do instead. */
  message: string;
  /** Optionally, who can — one line per role. */
  roles?: Array<{ icon: React.ElementType; name: string; access: string }>;
}

/**
 * A screen this account may not open.
 *
 * Every gated screen shows the same thing, so a refusal is recognisable rather than alarming — and
 * it says which role does have access, because the reader's real next step is usually to ask
 * someone rather than to try again.
 */
export const AccessDenied: React.FC<AccessDeniedProps> = ({ title, message, roles }) => (
  <div className={styles.screen}>
    <div className={styles.mark}>
      <Locked size={32} />
    </div>
    <h2 className={styles.title}>{title}</h2>
    <p className={styles.copy}>{message}</p>
    {roles && roles.length > 0 && (
      <div className={styles.roles}>
        {roles.map(({ icon: Icon, name, access }) => (
          <span key={name} className={styles.role}>
            <Icon size={16} />
            <span>
              <strong>{name}</strong> — {access}
            </span>
          </span>
        ))}
      </div>
    )}
  </div>
);

export default AccessDenied;
