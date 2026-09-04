import React from 'react';
import { useIsDesktop } from '@/hooks/useLayoutType';
import styles from './card-header.module.scss';

interface CardHeaderProps {
  /** The section's name. Shown with the school's colour marked underneath it. */
  title: string;
  /** Right-aligned actions — typically a ghost Button, sometimes a filter and a divider. */
  children?: React.ReactNode;
}

/**
 * The title bar at the top of a card.
 *
 * Every section in the app gets one, and that is the point: it is what makes a fee statement, an
 * inbox and a class list look like parts of one product rather than three screens by three people.
 * The title sits left with the brand underline beneath it; whatever the section can do sits right.
 */
export const CardHeader: React.FC<CardHeaderProps> = ({ title, children }) => (
  <div className={useIsDesktop() ? styles.desktopHeader : styles.tabletHeader}>
    <h4>{title}</h4>
    {children}
  </div>
);

export default CardHeader;
