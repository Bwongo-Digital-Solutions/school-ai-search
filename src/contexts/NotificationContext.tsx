import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Modal, ToastNotification } from '@carbon/react';
import styles from './notifications.module.scss';

/**
 * The app's own dialogs and notifications, so nothing has to fall back on the browser's.
 *
 * `alert()` and `confirm()` were used in 19 files. They are the wrong tool for three reasons that
 * matter here: they are drawn by the browser rather than the design system, so they arrive
 * unstyled and captioned "localhost:8787"; they block the JavaScript thread, so anything still
 * loading stops; and `confirm()` gives every destructive action the same two grey buttons, with no
 * way to mark which one is the dangerous one.
 *
 * This replaces both with Carbon's `ToastNotification` and `Modal`, behind an API close enough to
 * the originals that call sites read the same:
 *
 *   notify.error('Could not save', reason)      // was alert(...)
 *   if (await confirm({ ... })) { … }           // was if (window.confirm(...)) { … }
 */

type Kind = 'error' | 'success' | 'warning' | 'info';

interface Toast {
  id: number;
  kind: Kind;
  title: string;
  subtitle?: string;
}

interface ConfirmOptions {
  title: string;
  message: string;
  /** The affirmative button's label. Name the action — "Delete", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Marks the action destructive: red button, and the cancel is the safe default. */
  danger?: boolean;
}

interface NotificationContextType {
  notify: {
    error: (title: string, subtitle?: string) => void;
    success: (title: string, subtitle?: string) => void;
    warning: (title: string, subtitle?: string) => void;
    info: (title: string, subtitle?: string) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};

// Successes and notices clear themselves; errors and warnings stay until dismissed, because the
// text usually has to be read carefully or quoted to somebody.
const TIMEOUT: Record<Kind, number> = { success: 5000, info: 5000, warning: 0, error: 0 };

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(
    null,
  );
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: Kind, title: string, subtitle?: string) => {
      const id = nextId.current++;
      setToasts(current => [...current, { id, kind, title, subtitle }]);
      const timeout = TIMEOUT[kind];
      if (timeout) window.setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (answer: boolean) => {
      setPending(current => {
        current?.resolve(answer);
        return null;
      });
    },
    [],
  );

  const value = useMemo<NotificationContextType>(
    () => ({
      notify: {
        error: (title, subtitle) => push('error', title, subtitle),
        success: (title, subtitle) => push('success', title, subtitle),
        warning: (title, subtitle) => push('warning', title, subtitle),
        info: (title, subtitle) => push('info', title, subtitle),
      },
      confirm,
    }),
    [push, confirm],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}

      {toasts.length > 0 && (
        <div className={styles.stack} role="status" aria-live="polite">
          {toasts.map(toast => (
            <ToastNotification
              key={toast.id}
              className={styles.toast}
              kind={toast.kind}
              title={toast.title}
              subtitle={toast.subtitle}
              onClose={() => {
                dismiss(toast.id);
                return false;
              }}
              onCloseButtonClick={() => dismiss(toast.id)}
              lowContrast
            />
          ))}
        </div>
      )}

      {pending && (
        <Modal
          open
          danger={pending.danger}
          modalHeading={pending.title}
          primaryButtonText={pending.confirmLabel ?? 'Continue'}
          secondaryButtonText={pending.cancelLabel ?? 'Cancel'}
          onRequestSubmit={() => settle(true)}
          onRequestClose={() => settle(false)}
          size="sm"
        >
          <div className={styles.confirmBody}>
            <p>{pending.message}</p>
          </div>
        </Modal>
      )}
    </NotificationContext.Provider>
  );
};
