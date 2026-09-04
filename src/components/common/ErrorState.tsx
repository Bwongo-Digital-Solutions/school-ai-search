import React from 'react';
import classNames from 'classnames';
import { Button, Layer, Tile } from '@carbon/react';
import { Renew } from '@carbon/react/icons';
import { useIsDesktop, useResponsiveSize } from '@/hooks/useLayoutType';
import styles from './state-tile.module.scss';

interface ErrorStateProps {
  headerTitle: string;
  /** What went wrong. An Error, or a message already in plain words. */
  error?: unknown;
  /** Offer a retry when the failure is one a second attempt could survive. */
  onRetry?: () => void;
}

const messageOf = (error: unknown): string => {
  if (!error) return 'Something went wrong';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
};

/**
 * A section that could not load.
 *
 * Names the failure in the first line and what to do about it in the second, because a reader who
 * cannot fix it themselves still needs something specific to quote to whoever can.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({ headerTitle, error, onRetry }) => {
  const isDesktop = useIsDesktop();
  const size = useResponsiveSize();

  return (
    <Layer>
      <Tile className={styles.tile}>
        <div className={classNames(styles.heading, !isDesktop && styles.tabletHeading)}>
          <h4>{headerTitle}</h4>
        </div>
        <p className={styles.errorMessage}>{messageOf(error)}</p>
        <p className={styles.errorCopy}>
          This part of the page could not be loaded. Try again, and if it keeps happening tell
          whoever looks after the system — quoting the message above.
        </p>
        {onRetry && (
          <p className={styles.action}>
            <Button kind="ghost" onClick={onRetry} renderIcon={Renew} size={size}>
              Try again
            </Button>
          </p>
        )}
      </Tile>
    </Layer>
  );
};

export default ErrorState;
