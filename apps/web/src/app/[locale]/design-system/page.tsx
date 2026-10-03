import { notFound } from 'next/navigation';
import { parseWebEnv } from '@/lib/web-env';
import { DesignSystemShowcase } from './design-system-showcase';

/** Development reference for tokens and components; it must not exist in production (R-03). */
export default function DesignSystemPage() {
  if (parseWebEnv(process.env).NODE_ENV === 'production') notFound();
  return <DesignSystemShowcase />;
}
