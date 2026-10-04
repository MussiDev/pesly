import { createSerwistRoute } from '@serwist/turbopack';

/**
 * Serves the service worker built from `src/app/sw.ts` at `/serwist/sw.js`. The native esbuild is
 * asked for explicitly: the default depends on the operating system, and the wasm build is not a
 * dependency of this app.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'src/app/sw.ts',
    useNativeEsbuild: true,
  },
);
