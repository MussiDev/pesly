'use client';

import { todayInTimeZone } from '@pesly/shared';
import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline } from '@/lib/connectivity';

export interface ReportContext {
  /** `YYYY-MM-DD` in the profile's time zone; `undefined` until the zone is known. */
  today: string | undefined;
  timeZone: string | undefined;
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Reads the profile once for the time zone and gives today in it. Offline, or when the profile
 * cannot be read, the device's own time zone stands in so the presets still work.
 */
export function useReportContext(): ReportContext {
  const api = useApiClient();
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (isOffline()) {
      setTimeZone(deviceTimeZone());
      return;
    }
    void api.getProfile().then((result) => {
      if (!active) return;
      setTimeZone(result.ok ? result.data.preferences.timeZone : deviceTimeZone());
    });
    return () => {
      active = false;
    };
  }, [api]);

  return {
    today: timeZone === undefined ? undefined : todayInTimeZone(new Date(), timeZone),
    timeZone,
  };
}
