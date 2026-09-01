import React from 'react';
import styles from './app-footer.module.scss';

// Injected by vite.config.ts at build time; kept in sync with the server's version.mjs.
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev';
const DEVELOPER = typeof __DEVELOPER_CONTACTS__ !== 'undefined' ? __DEVELOPER_CONTACTS__ : '';

/** Slim product footer shown on every screen. */
const AppFooter: React.FC = () => (
  <footer className={styles.footer}>
    <div className={styles.line}>
      <span className={styles.product}>Powered by e-School</span>
      <span aria-hidden>·</span>
      <span>
        v{VERSION} (build {BUILD})
      </span>
      {DEVELOPER && (
        <>
          <span aria-hidden>·</span>
          <span>{DEVELOPER}</span>
        </>
      )}
    </div>
  </footer>
);

export default AppFooter;
