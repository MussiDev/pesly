'use client';

import { MOVEMENT_TAGS_MAX_COUNT, MOVEMENT_TAG_MAX_LENGTH } from '@pesly/shared';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tagErrorMessage, type MovementFieldMessage, type TagError } from '../movement-form-errors';

export interface TagInputProps {
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Stored tags matching the typed prefix, in the spelling they were first saved with. */
  suggestions: readonly string[];
  /** Called with the text in the box on every change, and with '' once a tag is added. */
  onPrefixChange: (prefix: string) => void;
  /** A message from outside the field, for example a failed check at submit. */
  error?: MovementFieldMessage | undefined;
}

function sameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Chips and a text box. It never fetches: the container feeds `suggestions` and listens to
 * `onPrefixChange`. The limits come from the shared constants; the server stays the authority.
 */
export function TagInput({ value, onChange, suggestions, onPrefixChange, error }: TagInputProps) {
  const t = useTranslations();
  const id = useId();
  const [text, setText] = useState('');
  const [refusal, setRefusal] = useState<TagError | undefined>();

  const full = value.length >= MOVEMENT_TAGS_MAX_COUNT;
  const shown =
    refusal === undefined ? (full ? tagErrorMessage('limit') : error) : tagErrorMessage(refusal);
  const visibleSuggestions = suggestions.filter(
    (suggestion) => !value.some((tag) => sameTag(tag, suggestion)),
  );

  function reset() {
    setText('');
    onPrefixChange('');
  }

  /** Adds `raw` trimmed unless it is refused; a duplicate is dropped quietly. */
  function add(raw: string) {
    const tag = raw.trim();
    if (tag === '') {
      setRefusal('empty');
      return;
    }
    if (Array.from(tag).length > MOVEMENT_TAG_MAX_LENGTH) {
      setRefusal('tooLong');
      return;
    }
    if (value.some((chosen) => sameTag(chosen, tag))) {
      setRefusal(undefined);
      reset();
      return;
    }
    if (full) {
      setRefusal('limit');
      return;
    }
    setRefusal(undefined);
    onChange([...value, tag]);
    reset();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setText(event.currentTarget.value);
    setRefusal(undefined);
    onPrefixChange(event.currentTarget.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== ',') return;
    // Enter must not submit the entry form, and the comma is a separator, not text.
    event.preventDefault();
    add(text);
  }

  return (
    <div className="grid gap-2">
      <Label
        htmlFor={id}
        data-error={Boolean(shown)}
        className="data-[error=true]:text-destructive"
      >
        {t('movements.tags.label')}
      </Label>
      <Input
        id={id}
        type="text"
        autoComplete="off"
        value={text}
        placeholder={t('movements.tags.placeholder')}
        aria-invalid={Boolean(shown)}
        aria-describedby={shown ? `${id}-message` : `${id}-hint`}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('movements.tags.hint', { limit: MOVEMENT_TAGS_MAX_COUNT })}
      </p>
      {shown ? (
        <p id={`${id}-message`} className="text-sm text-destructive">
          {t(shown, { max: MOVEMENT_TAG_MAX_LENGTH, limit: MOVEMENT_TAGS_MAX_COUNT })}
        </p>
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <ul aria-label={t('movements.tags.suggestions')} className="flex flex-wrap gap-2">
          {visibleSuggestions.map((suggestion) => (
            <li key={suggestion}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  add(suggestion);
                }}
              >
                {suggestion}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length > 0 ? (
        <ul aria-label={t('movements.tags.chips')} className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <li key={tag}>
              <Badge className="gap-1 pr-1">
                {tag}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={t('movements.tags.remove', { tag })}
                  onClick={() => {
                    onChange(value.filter((chosen) => chosen !== tag));
                  }}
                >
                  <X aria-hidden />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
