import React from 'react';
import classNames from 'classnames';
import { Button, Layer, Tile } from '@carbon/react';
import { Add } from '@carbon/react/icons';
import { useIsDesktop, useResponsiveSize } from '@/hooks/useLayoutType';
import EmptyStateIllustration from './EmptyStateIllustration';
import styles from './state-tile.module.scss';

interface EmptyStateProps {
  /** The section's name, so the reader still knows what they are looking at. */
  headerTitle: string;
  /** What there is none of — "students", "unpaid invoices". Reads into the sentence below. */
  displayText: string;
  /** An optional second line: why it might be empty, or what to try. */
  helperText?: string;
  /** Label for the action, when there is one. */
  actionText?: string;
  onAction?: () => void;
}

/**
 * A section with nothing in it.
 *
 * Says what is missing in the section's own words rather than "No data", and — where there is
 * something the reader can do about it — offers that action right here, because the moment someone
 * discovers a list is empty is the moment they want to add the first thing to it.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  headerTitle,
  displayText,
  helperText,
  actionText,
  onAction,
}) => {
  const isDesktop = useIsDesktop();
  const size = useResponsiveSize();

  return (
    <Layer>
      <Tile className={styles.tile}>
        <div className={classNames(styles.heading, !isDesktop && styles.tabletHeading)}>
          <h4>{headerTitle}</h4>
        </div>
        <div className={styles.illustration}>
          <EmptyStateIllustration />
        </div>
        <p className={styles.content}>There are no {displayText} to show.</p>
        {helperText && <p className={styles.helper}>{helperText}</p>}
        {onAction && (
          <p className={styles.action}>
            <Button kind="ghost" onClick={onAction} renderIcon={Add} size={size}>
              {actionText || `Add ${displayText}`}
            </Button>
          </p>
        )}
      </Tile>
    </Layer>
  );
};

export default EmptyState;
