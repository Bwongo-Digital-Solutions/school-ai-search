import React from 'react';
import classNames from 'classnames';
import { useSettings } from '@/contexts/SettingsContext';
import styles from './page-header.module.scss';

interface PageHeaderProps {
  /** The screen's name — "Fee management", "Student records". */
  title: string;
  /** A picture for the screen, in the school's colour. Optional but strongly preferred. */
  illustration?: React.ReactNode;
  /** Filters, date pickers and buttons that act on the whole screen. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The bar at the top of a full screen.
 *
 * Carries the school's name above the page's own, so someone looking at a printout or a shared
 * screenshot can tell which school it came from — this is one deployment serving many, and that
 * ambiguity is worth spending a line of the header to remove.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, illustration, children, className }) => {
  const { settings } = useSettings();

  return (
    <div className={classNames(styles.pageHeader, className)}>
      <div className={styles.content}>
        {illustration && <div className={styles.illustration}>{illustration}</div>}
        <div className={styles.labels}>
          {settings.school_name && <p className={styles.supraLabel}>{settings.school_name}</p>}
          <p className={styles.pageName}>{title}</p>
        </div>
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
};

export default PageHeader;
