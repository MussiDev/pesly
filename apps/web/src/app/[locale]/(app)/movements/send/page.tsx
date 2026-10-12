import { Suspense } from 'react';
import { SendToGroupRouteContainer } from '@/features/movements/send-to-group/send-to-group-container';

/** The send-to-group screen with the movement in the query string (`?id=`). */
export default function SendMovementToGroupPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      {/* useSearchParams needs a Suspense boundary to keep the page prerenderable. */}
      <Suspense>
        <SendToGroupRouteContainer />
      </Suspense>
    </main>
  );
}
