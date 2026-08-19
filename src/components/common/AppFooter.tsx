import React from 'react';

// Injected by vite.config.ts at build time; kept in sync with the server's version.mjs.
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev';
const DEVELOPER = typeof __DEVELOPER_CONTACTS__ !== 'undefined' ? __DEVELOPER_CONTACTS__ : '';

/** Slim product footer shown on every screen. */
const AppFooter: React.FC = () => (
  <footer className="shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-1.5">
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
      <span className="font-medium text-gray-500 dark:text-gray-400">Powered by e-School</span>
      <span aria-hidden>·</span>
      <span>v{VERSION} (build {BUILD})</span>
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
