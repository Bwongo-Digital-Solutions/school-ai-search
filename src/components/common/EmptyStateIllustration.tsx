import React from 'react';

/**
 * The drawing shown when a section has nothing in it: a sheet of paper with a few ruled lines.
 *
 * Deliberately quiet and monochrome. An empty section is not an event, and an illustration that
 * competes with the interface around it would make routine emptiness feel like a problem.
 */
export const EmptyStateIllustration: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <rect x="14" y="8" width="36" height="48" rx="1" fill="#F4F4F4" stroke="#C6C6C6" strokeWidth="1.5" />
    <path d="M22 20h20M22 28h20M22 36h13" stroke="#C6C6C6" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="43" cy="45" r="9" fill="#FFFFFF" stroke="#8D8D8D" strokeWidth="1.5" />
    <path d="M39.5 45h7" stroke="#8D8D8D" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export default EmptyStateIllustration;
