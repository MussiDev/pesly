'use client';

import { CircleAlert, Inbox, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  FormSelect,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

// Tailwind needs every class name written out, so each token carries its own utility.
const COLOR_TOKENS = [
  ['background', 'bg-background'],
  ['surface', 'bg-surface'],
  ['card', 'bg-card'],
  ['muted', 'bg-muted'],
  ['secondary', 'bg-secondary'],
  ['accent', 'bg-accent'],
  ['border', 'bg-border'],
  ['input', 'bg-input'],
  ['ring', 'bg-ring'],
  ['primary', 'bg-primary'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['destructive', 'bg-destructive'],
  ['info', 'bg-info'],
  ['income', 'bg-income'],
  ['expense', 'bg-expense'],
  ['category-red', 'bg-category-red'],
  ['category-orange', 'bg-category-orange'],
  ['category-amber', 'bg-category-amber'],
  ['category-yellow', 'bg-category-yellow'],
  ['category-lime', 'bg-category-lime'],
  ['category-green', 'bg-category-green'],
  ['category-teal', 'bg-category-teal'],
  ['category-cyan', 'bg-category-cyan'],
  ['category-blue', 'bg-category-blue'],
  ['category-violet', 'bg-category-violet'],
  ['category-pink', 'bg-category-pink'],
  ['category-slate', 'bg-category-slate'],
] as const;

const TYPE_STEPS = [
  ['display', 'text-display'],
  ['title', 'text-title'],
  ['heading', 'text-heading'],
  ['body', 'text-body'],
  ['small', 'text-small'],
  ['caption', 'text-caption'],
] as const;

const BUTTON_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'link',
  'destructive',
] as const;
const ALERT_VARIANTS = ['default', 'success', 'warning', 'info', 'destructive'] as const;
const BADGE_VARIANTS = ['default', 'outline', 'success', 'warning', 'info', 'destructive'] as const;

// Minor units as bigint, never a float.
const SALARY = 185000000n;
const GROCERIES = 4250050n;
const SAVINGS = 120000n;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-heading">{title}</h2>
      {children}
    </section>
  );
}

function Preview({ theme }: { theme: 'light' | 'dark' }) {
  const t = useTranslations('ui.designSystem');
  const tUi = useTranslations('ui');
  const language: Locale = useLocale() === 'en' ? 'en' : 'es';

  return (
    <div
      data-theme-preview={theme}
      className={cn(
        theme === 'dark' && 'dark',
        'grid gap-section rounded-xl border bg-background p-page text-foreground',
      )}
    >
      <h2 className="text-title">{t(`previews.${theme}`)}</h2>

      <Section title={t('sections.colors')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLOR_TOKENS.map(([name, utility]) => (
            <div key={name} className="grid gap-1.5">
              <div className={cn(utility, 'h-10 rounded-md border')} />
              <code className="text-caption text-muted-foreground">{`--${name}`}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('sections.typography')}>
        <div className="grid gap-2">
          {TYPE_STEPS.map(([name, utility]) => (
            <p key={name} className={utility}>
              {t(`type.${name}`)}: {t('type.sample')}
            </p>
          ))}
        </div>
      </Section>

      <Section title={t('sections.shape')}>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-small text-muted-foreground">{t('shape.radius')}</span>
            <div className="size-12 rounded-sm border bg-card" />
            <div className="size-12 rounded-md border bg-card" />
            <div className="size-12 rounded-lg border bg-card" />
            <div className="size-12 rounded-xl border bg-card" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-small text-muted-foreground">{t('shape.elevation')}</span>
            <div className="size-12 rounded-lg border bg-card shadow-xs" />
            <div className="size-12 rounded-lg border bg-card shadow-md" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-small text-muted-foreground">{t('shape.spacing')}</span>
            <div className="h-3 w-1 bg-primary" />
            <div className="h-3 w-2 bg-primary" />
            <div className="h-3 w-4 bg-primary" />
            <div className="h-3 w-8 bg-primary" />
            <div className="h-3 w-page bg-primary" />
            <div className="h-3 w-section bg-primary" />
          </div>
        </div>
      </Section>

      <Section title={t('sections.motion')}>
        <p className="text-small text-muted-foreground">{t('motion.description')}</p>
        <div className="w-fit rounded-lg border bg-card px-4 py-3 text-small shadow-xs transition-transform duration-base ease-standard hover:-translate-y-0.5">
          {t('motion.sample')}
        </div>
      </Section>

      <Section title={t('sections.buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>{t('states.disabled')}</Button>
          <Button size="sm">{t('sizes.small')}</Button>
          <Button size="lg">{t('sizes.large')}</Button>
          <Button size="icon" aria-label={t('sizes.icon')}>
            <Plus aria-hidden />
          </Button>
        </div>
      </Section>

      <Section title={t('sections.controls')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormItem hasDescription>
            <FormLabel>{t('controls.text')}</FormLabel>
            <FormControl placeholder={t('controls.placeholder')} />
            <FormDescription>{t('controls.hint')}</FormDescription>
          </FormItem>
          <FormItem invalid>
            <FormLabel>{t('states.invalid')}</FormLabel>
            <FormControl defaultValue={t('controls.placeholder')} />
            <FormMessage>{t('controls.error')}</FormMessage>
          </FormItem>
          <FormItem>
            <FormLabel>{t('controls.select')}</FormLabel>
            <FormSelect>
              <option>{t('controls.optionOne')}</option>
              <option>{t('controls.optionTwo')}</option>
            </FormSelect>
          </FormItem>
          <Input aria-label={t('states.disabled')} placeholder={t('states.disabled')} disabled />
          <label className="flex min-h-11 items-center gap-3 text-small">
            <Checkbox />
            {t('controls.checkbox')}
          </label>
        </div>
      </Section>

      <Section title={t('sections.alerts')}>
        <div className="grid gap-3">
          {ALERT_VARIANTS.map((variant) => (
            <Alert key={variant} variant={variant}>
              <CircleAlert aria-hidden />
              <AlertTitle>{t('alerts.title')}</AlertTitle>
              <AlertDescription>{t('alerts.description')}</AlertDescription>
            </Alert>
          ))}
        </div>
      </Section>

      <Section title={t('sections.badges')}>
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {t(`variants.${variant}`)}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title={t('sections.amounts')}>
        <div className="grid gap-2 text-body">
          <div className="flex items-center justify-between">
            <span>{t('amounts.income')}</span>
            <Amount value={SALARY} currency="ARS" locale={language} kind="income" />
          </div>
          <div className="flex items-center justify-between">
            <span>{t('amounts.expense')}</span>
            <Amount value={GROCERIES} currency="ARS" locale={language} kind="expense" />
          </div>
          <div className="flex items-center justify-between">
            <span>{t('amounts.balance')}</span>
            <Amount value={SAVINGS} currency="USD" locale={language} />
          </div>
        </div>
      </Section>

      <Section title={t('sections.states')}>
        <div className="grid gap-2" role="status" aria-label={tUi('loading')}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10 w-full" />
        </div>
        <EmptyState
          icon={<Inbox aria-hidden />}
          title={tUi('empty.title')}
          description={tUi('empty.description')}
          action={<Button>{tUi('empty.action')}</Button>}
        />
        <ErrorState
          title={tUi('error.title')}
          description={tUi('error.description')}
          retryLabel={tUi('retry')}
          onRetry={() => undefined}
        />
      </Section>

      <Section title={t('sections.rows')}>
        <div className="divide-y rounded-lg border bg-card px-3">
          <ListRow
            title={t('rows.title')}
            description={t('rows.description')}
            trailing={<Amount value={SALARY} currency="ARS" locale={language} kind="income" />}
          />
          <ListRow
            title={t('rows.title')}
            description={t('rows.trailing')}
            trailing={<Amount value={GROCERIES} currency="ARS" locale={language} kind="expense" />}
          />
        </div>
      </Section>
    </div>
  );
}

export function DesignSystemShowcase() {
  const t = useTranslations('ui.designSystem');
  return (
    <main className="mx-auto grid max-w-5xl gap-section p-page">
      <PageHeader title={t('title')} description={t('description')} actions={<ThemeToggle />} />
      <Preview theme="light" />
      <Preview theme="dark" />
    </main>
  );
}
