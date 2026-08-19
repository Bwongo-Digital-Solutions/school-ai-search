import React from 'react';
import { X } from 'lucide-react';

/** The overlay + panel used by the dialogs across the chat screens, with a sticky header. */
const ModalShell = ({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) => (
  <div
    className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col overflow-hidden`}
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <div>
          <h3 className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-indigo-500" />}
            {title}
          </h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">{children}</div>

      {footer && (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          {footer}
        </div>
      )}
    </div>
  </div>
);

export default ModalShell;
