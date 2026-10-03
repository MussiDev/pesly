import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** Public authentication screens: the wordmark above one centered card, mobile first. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('app');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <p className="text-center text-display text-primary">{t('brand')}</p>
      {children}
    </main>
  );
}
