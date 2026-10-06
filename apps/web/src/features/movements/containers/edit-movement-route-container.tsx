'use client';

import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { EditMovementContainer, MovementNotFoundView } from './edit-movement-container';

const movementIdSchema = z.uuid();

/** Reads the movement id from the query string; anything but a UUID is no movement of the user. */
export function EditMovementRouteContainer() {
  const id = movementIdSchema.safeParse(useSearchParams().get('id'));
  if (!id.success) return <MovementNotFoundView />;
  return <EditMovementContainer key={id.data} movementId={id.data} />;
}
