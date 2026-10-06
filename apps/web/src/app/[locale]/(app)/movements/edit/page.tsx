import { Suspense } from 'react';
import { EditMovementRouteContainer } from '@/features/movements/containers/edit-movement-route-container';

/**
 * The edit screen with the movement in the query string (`?id=`), so the one page the service
 * worker caches serves every movement without a connection.
 */
export default function EditMovementByQueryPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      {/* useSearchParams needs a Suspense boundary to keep the page prerenderable. */}
      <Suspense>
        <EditMovementRouteContainer />
      </Suspense>
    </main>
  );
}
