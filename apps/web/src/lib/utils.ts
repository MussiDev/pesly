import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The type scale in globals.css (`--text-*`) generates `text-display` and friends. Without this,
// tailwind-merge reads them as text colours, and a later colour class silently drops the size.
const twMerge = extendTailwindMerge({
  extend: {
    // `--spacing-page` and `--spacing-section` generate `p-page`, `gap-section`, `w-page`...
    theme: { spacing: ['page', 'section'] },
    classGroups: {
      duration: [{ duration: ['fast', 'base'] }],
      ease: [{ ease: ['standard'] }],
      'font-size': [{ text: ['display', 'title', 'heading', 'body', 'small', 'caption', 'nav'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
