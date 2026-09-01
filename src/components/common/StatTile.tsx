import React from 'react';
import styles from './stat-tile.module.scss';

type Tone = 'default' | 'warning' | 'danger' | 'success';

interface StatTileProps {
  label: string;
  value: string | number;
  /** An icon component — Carbon's or lucide's; both take a numeric `size`. */
  icon: React.ElementType;
  /** Colours the icon, to mark the figure worth watching. Never the number itself. */
  tone?: Tone;
}

/**
 * One labelled number, in the band across the top of a screen.
 *
 * Used on ten screens, which is the point: a fee total, a class average and an error count all look
 * the same, so a reader learns to read the band once. Follows the OpenMRS metric card — hairline
 * border, grey label, the figure in `heading-04`.
 */
export const StatTile: React.FC<StatTileProps> = ({ label, value, icon: Icon, tone = 'default' }) => (
  <div className={`${styles.tile} ${styles[tone]}`}>
    <div className={styles.label}>
      <Icon size={16} />
      {label}
    </div>
    <p className={styles.value}>{value}</p>
  </div>
);

/** The row a set of StatTiles sits in: equal widths, wrapping, never narrower than legible. */
export const StatRow: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={`${styles.row} ${className || ''}`}>{children}</div>;

export default StatTile;
