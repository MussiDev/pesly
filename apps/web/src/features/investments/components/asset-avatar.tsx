import { Avatar } from '@/components/ui/avatar';
import { resolveAsset } from '@/lib/logos/resolve-asset';

/** The logo of a holding's ticker when the catalog has one, otherwise the ticker's first two letters. */
export function AssetAvatar({ ticker }: { ticker: string }) {
  const asset = resolveAsset(ticker);
  return <Avatar src={asset?.logo} fallback={ticker.trim().slice(0, 2).toUpperCase()} />;
}
