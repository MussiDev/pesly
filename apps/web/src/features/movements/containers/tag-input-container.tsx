'use client';

import { TAG_SUGGESTIONS_DEFAULT_LIMIT } from '@pesly/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { TagInput } from '../components/tag-input';
import type { MovementFieldMessage } from '../movement-form-errors';

/** Quiet time after the last key before the suggestions are requested. */
const DEBOUNCE_MS = 250;

export interface TagInputContainerProps {
  value: readonly string[];
  onChange: (value: string[]) => void;
  error?: MovementFieldMessage | undefined;
  /** The tags kept on the device: when given, suggestions come from them and no request is made. */
  localTags?: readonly string[] | undefined;
}

/** Feeds `TagInput` with the caller's stored tags for the typed prefix. */
export function TagInputContainer({ value, onChange, error, localTags }: TagInputContainerProps) {
  const api = useApiClient();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest prefix asked for: an answer for any other one is stale and dropped.
  const latest = useRef('');

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      latest.current = '';
    },
    [],
  );

  const handlePrefixChange = useCallback(
    (prefix: string) => {
      clearTimeout(timer.current);
      const trimmed = prefix.trim();
      latest.current = trimmed;
      if (trimmed === '') {
        setSuggestions([]);
        return;
      }
      if (localTags !== undefined) {
        const lowered = trimmed.toLowerCase();
        setSuggestions(
          localTags
            .filter((tag) => tag.toLowerCase().startsWith(lowered))
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            .slice(0, TAG_SUGGESTIONS_DEFAULT_LIMIT),
        );
        return;
      }
      timer.current = setTimeout(() => {
        void api
          .listTags({ prefix: trimmed, limit: TAG_SUGGESTIONS_DEFAULT_LIMIT })
          .then((result) => {
            if (latest.current !== trimmed) return;
            // A failure is not worth a banner: suggestions are a convenience, saving never needs them.
            setSuggestions(result.ok ? result.data.items : []);
          });
      }, DEBOUNCE_MS);
    },
    [api, localTags],
  );

  return (
    <TagInput
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      onPrefixChange={handlePrefixChange}
      error={error}
    />
  );
}
