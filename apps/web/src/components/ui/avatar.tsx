'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Pixel sizes of each variant: the `<img>` carries them so its box exists before it loads. */
const PIXELS = { sm: 32, md: 40, lg: 48 } as const;

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-logo-surface',
  {
    variants: { size: { sm: 'size-8', md: 'size-10', lg: 'size-12' } },
    defaultVariants: { size: 'md' },
  },
);

interface AvatarProps extends VariantProps<typeof avatarVariants> {
  /** A same-origin logo path. Without one, or when it fails to load, the fallback shows. */
  src?: string;
  /** Initials or an icon; decorative, because the row text always names the thing. */
  fallback: ReactNode;
  className?: string;
}

export function Avatar({ src, fallback, size, className }: AvatarProps) {
  // The src that failed, not a boolean: a new src is tried again without an effect to reset it.
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const pixels = PIXELS[size ?? 'md'];
  const showImage = src !== undefined && src !== failedSrc;

  return (
    <span data-slot="avatar" className={cn(avatarVariants({ size }), className)}>
      {showImage ? (
        <img
          src={src}
          alt=""
          width={pixels}
          height={pixels}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailedSrc(src);
          }}
          className="size-full object-contain p-1.5"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-full items-center justify-center bg-secondary text-caption font-semibold text-secondary-foreground [&>svg]:size-5"
        >
          {fallback}
        </span>
      )}
    </span>
  );
}
