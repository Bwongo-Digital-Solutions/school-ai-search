import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@carbon/react';
import { ArrowLeft } from '@carbon/react/icons';
import styles from './public-pages.module.scss';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error('404: no route for', location.pathname);
  }, [location.pathname]);

  return (
    <div className={styles.page}>
      <div className={styles.centred}>
        <div className={`${styles.card} ${styles.cardNarrow}`}>
          <div className={`${styles.section} ${styles.centredText}`}>
            <h1 className={styles.title}>Page not found</h1>
            <p className={styles.lede}>
              There is nothing at <code>{location.pathname}</code>.
            </p>
            <div>
              <Button kind="tertiary" renderIcon={ArrowLeft} href="/">
                Back to the app
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
