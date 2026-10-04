import { beforeEach, describe, expect, it } from 'vitest';
import { DeleteMovement } from '../../src/movements/application/delete-movement';
import { ResourceNotFound } from '../../src/shared/access';
import { InMemoryMovementRepository, writeScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';

let movements: InMemoryMovementRepository;
let remove: DeleteMovement;

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  remove = new DeleteMovement({ movements });
});

describe('DeleteMovement', () => {
  it('deletes an existing movement with one call to the repository (AC-02)', async () => {
    const stored = movements.seed(ALICE);

    await remove.execute(await writeScopeFor(ALICE), stored.id);

    expect(movements.deleteCalls).toHaveLength(1);
    expect(movements.rows).toHaveLength(0);
  });

  it('answers not found for a movement of another owner and leaves it in place (AC-03)', async () => {
    const stored = movements.seed(ALICE);

    await expect(remove.execute(await writeScopeFor(BOB), stored.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );

    expect(movements.rows).toHaveLength(1);
  });

  it('answers 404 for a missing id and for a second delete of the same movement (FR-03)', async () => {
    const stored = movements.seed(ALICE);
    const scope = await writeScopeFor(ALICE);

    await expect(remove.execute(scope, UNKNOWN)).rejects.toBeInstanceOf(ResourceNotFound);
    await remove.execute(scope, stored.id);
    await expect(remove.execute(scope, stored.id)).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('propagates a repository failure on delete unchanged (FR-02)', async () => {
    const stored = movements.seed(ALICE);
    movements.deleteError = new Error('database down');

    await expect(remove.execute(await writeScopeFor(ALICE), stored.id)).rejects.toThrow(
      'database down',
    );
  });
});
