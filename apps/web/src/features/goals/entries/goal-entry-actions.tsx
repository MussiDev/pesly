'use client';

import type { GoalEntryKind, GoalResponse, RecordGoalEntryResponse } from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { goalFailureKey } from '../helpers/goal-failure';
import { buildEntry } from '../helpers/goal-request';
import { GoalEntryForm } from './goal-entry-form';
import { LinkedGoalNotice } from './linked-goal-notice';

export interface GoalEntryActionsProps {
  goal: GoalResponse;
  onRecorded: (response: RecordGoalEntryResponse) => void;
}

interface FormState {
  pending: boolean;
  fieldError?: string;
  failure?: string;
  recorded: boolean;
  /** Bumped on success so the form remounts and the amount clears. */
  generation: number;
}

const INITIAL: FormState = { pending: false, recorded: false, generation: 0 };
const KINDS: GoalEntryKind[] = ['contribution', 'withdrawal'];

/** The contribution and withdrawal forms of an unlinked goal, or the linked-goal notice. */
export function GoalEntryActions({ goal, onRecorded }: GoalEntryActionsProps) {
  const api = useApiClient();
  const locale = useLocale();
  const [states, setStates] = useState<Record<GoalEntryKind, FormState>>({
    contribution: INITIAL,
    withdrawal: INITIAL,
  });
  // A ref, not state: a second tap in the same tick must see the first one.
  const locked = useRef(false);

  if (goal.accountId !== null) return <LinkedGoalNotice />;

  function patch(kind: GoalEntryKind, change: (state: FormState) => FormState) {
    setStates((current) => ({ ...current, [kind]: change(current[kind]) }));
  }

  async function submit(kind: GoalEntryKind, text: string) {
    if (locked.current) return;
    const built = buildEntry(kind, text, locale);
    if (built.error !== undefined) {
      patch(kind, (state) => ({
        ...state,
        fieldError: built.error,
        failure: undefined,
        recorded: false,
      }));
      return;
    }
    locked.current = true;
    patch(kind, (state) => ({
      ...state,
      pending: true,
      fieldError: undefined,
      failure: undefined,
      recorded: false,
    }));
    try {
      const result = await api.recordGoalEntry(goal.id, built.request);
      if (result.ok) {
        patch(kind, (state) => ({
          pending: false,
          recorded: true,
          generation: state.generation + 1,
        }));
        onRecorded(result.data);
        return;
      }
      const failure = goalFailureKey(result);
      patch(kind, (state) => ({
        ...state,
        pending: false,
        failure: failure.kind === 'not-found' ? 'goals.detail.notFound.description' : failure.key,
      }));
    } finally {
      locked.current = false;
    }
  }

  return (
    <div className="grid gap-6">
      {KINDS.map((kind) => (
        <GoalEntryForm
          key={`${kind}-${states[kind].generation}`}
          kind={kind}
          pending={states[kind].pending}
          fieldError={states[kind].fieldError}
          failure={states[kind].failure}
          recorded={states[kind].recorded}
          onSubmit={(text) => {
            void submit(kind, text);
          }}
        />
      ))}
    </div>
  );
}
