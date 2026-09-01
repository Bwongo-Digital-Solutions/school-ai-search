import React from 'react';
import classNames from 'classnames';
import styles from './widget-card.module.scss';

interface WidgetCardProps {
  children: React.ReactNode;
  className?: string;
  /** Drop the bottom border, for a card that runs into whatever is directly beneath it. */
  flush?: boolean;
  /** Pad the body. Off by default, because a table wants to reach the card's edges. */
  padded?: boolean;
}

/** The white pane every section lives in. See `widget-card.module.scss` for why it is so plain. */
export const WidgetCard: React.FC<WidgetCardProps> = ({ children, className, flush, padded }) => (
  <div
    className={classNames(
      styles.widgetCard,
      flush && styles.flush,
      padded && styles.padded,
      className,
    )}
  >
    {children}
  </div>
);

export default WidgetCard;
