import { CreateMovementContainer } from '@/features/movements/containers/create-movement-container';
import { parseInitialType } from '@/features/movements/initial-type';

/**
 * Reads only the `type` the quick actions link with; this Server Component never touches financial
 * data. The value is validated before it reaches the screen.
 */
export default async function NewMovementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <CreateMovementContainer initialType={parseInitialType(type)} />
    </main>
  );
}
