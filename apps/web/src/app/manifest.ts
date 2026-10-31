import type { MetadataRoute } from 'next';
import messages from '../../messages/es.json';
import { routing } from '@/i18n/routing';
import { THEME_COLORS } from '@/lib/theme-colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.metadata.title,
    short_name: messages.metadata.title,
    description: messages.metadata.description,
    lang: routing.defaultLocale,
    start_url: `/${routing.defaultLocale}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: THEME_COLORS.lightBackground,
    theme_color: THEME_COLORS.lightBackground,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
