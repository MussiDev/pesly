'use client';

import {
  DISPLAY_CURRENCY_VALUES,
  LANGUAGE_VALUES,
  RATE_TYPES,
  type ProfileResponse,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormItem, FormLabel, FormMessage, FormSelect } from '@/components/ui/form';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import type { ProfileFormErrors } from '../profile-errors';
import { useFocusInvalid } from '../use-focus-invalid';
import { SavedNotice } from './saved-notice';

export type PreferencesValues = ProfileResponse['preferences'];

export interface PreferencesFormProps {
  preferences: PreferencesValues;
  /** The options of the time zone select; it must include the saved zone. */
  timeZones: readonly string[];
  /** Offered first, in their own group above the full list. */
  suggestedTimeZones?: readonly string[];
  pending: boolean;
  /** The last submit was saved. */
  saved: boolean;
  errors: ProfileFormErrors;
  /** The selected values as read from the form; the container validates them. */
  onSubmit: (values: PreferencesValues) => void;
}

/** A select only offers listed values; anything else falls back to what is saved. */
function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** Default rate type, display currency, time zone and interface language. */
export function PreferencesForm({
  preferences,
  timeZones,
  suggestedTimeZones = [],
  pending,
  saved,
  errors,
  onSubmit,
}: PreferencesFormProps) {
  const t = useTranslations('profile');
  const tErrors = useTranslations('profile.errors');
  const formRef = useFocusInvalid(errors);
  const timeZoneError = errors.fields?.timeZone;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      defaultRateType: pick(
        readField(form, 'defaultRateType'),
        RATE_TYPES,
        preferences.defaultRateType,
      ),
      displayCurrency: pick(
        readField(form, 'displayCurrency'),
        DISPLAY_CURRENCY_VALUES,
        preferences.displayCurrency,
      ),
      // Any zone string: the container checks it with the shared schema.
      timeZone: readField(form, 'timeZone'),
      language: pick(readField(form, 'language'), LANGUAGE_VALUES, preferences.language),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('preferences.title')}</CardTitle>
        <CardDescription>{t('preferences.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <SavedNotice saved={saved} />
          <FormAlert error={errors.form} />
          <FormItem>
            <FormLabel>{t('preferences.defaultRateType')}</FormLabel>
            <FormSelect name="defaultRateType" defaultValue={preferences.defaultRateType}>
              {RATE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`rateTypes.${value}`)}
                </option>
              ))}
            </FormSelect>
          </FormItem>
          <FormItem>
            <FormLabel>{t('preferences.displayCurrency')}</FormLabel>
            <FormSelect name="displayCurrency" defaultValue={preferences.displayCurrency}>
              {DISPLAY_CURRENCY_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`currencies.${value}`)}
                </option>
              ))}
            </FormSelect>
          </FormItem>
          <FormItem invalid={Boolean(timeZoneError)}>
            <FormLabel>{t('preferences.timeZone')}</FormLabel>
            <FormSelect name="timeZone" defaultValue={preferences.timeZone}>
              {suggestedTimeZones.length === 0 ? (
                timeZones.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))
              ) : (
                <>
                  <optgroup label={t('preferences.timeZoneSuggested')}>
                    {suggestedTimeZones.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('preferences.timeZoneAll')}>
                    {timeZones
                      .filter((value) => !suggestedTimeZones.includes(value))
                      .map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                  </optgroup>
                </>
              )}
            </FormSelect>
            <FormMessage>{timeZoneError ? tErrors(timeZoneError) : null}</FormMessage>
          </FormItem>
          <FormItem>
            <FormLabel>{t('preferences.language')}</FormLabel>
            <FormSelect name="language" defaultValue={preferences.language}>
              {LANGUAGE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`languages.${value}`)}
                </option>
              ))}
            </FormSelect>
          </FormItem>
          <Button type="submit" disabled={pending}>
            {pending ? t('preferences.pending') : t('preferences.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
