import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** Public authentication screens: the wordmark above one centered card, mobile first. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <p className="flex items-center justify-center gap-3 text-display text-primary">
        <span
          aria-hidden
          data-slot="brand-mark"
          className="inline-flex size-12 items-center justify-center rounded-xl bg-primary text-title text-primary-foreground"
        >
          {t('brand').charAt(0)}
        </span>
        {t('brand')}
      </p>
      {children}
    </main>
  );
}
