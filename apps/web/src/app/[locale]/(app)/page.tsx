import { HomeContainer } from '@/features/home/containers/home-container';

// A Server Component with no data access: the balance and movements are fetched by the client
// container through the Express API.
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
      <HomeContainer />
    </main>
  );
}
