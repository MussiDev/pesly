'use client';

import type { GroupResponse } from '@pesly/shared';
import { ChevronRight, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Link } from '@/i18n/navigation';

interface GroupsListProps {
  groups: readonly GroupResponse[];
}

/** Every group of the user with their role and member count; each row opens the group. */
export function GroupsList({ groups }: GroupsListProps) {
  const t = useTranslations('groups.list');

  const create = (
    <Link href="/groups/new" className={buttonVariants()}>
      {t('create')}
    </Link>
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={t('empty.title')}
        description={t('empty.joinHint')}
        action={create}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <ul className="divide-y divide-border/70 rounded-card bg-card px-4" aria-label={t('label')}>
        {groups.map((group) => (
          <li key={group.id}>
            <Link
              href={`/groups/${encodeURIComponent(group.id)}`}
              className="block rounded-md focus-visible:outline-2"
            >
              <ListRow
                interactive
                title={group.name}
                description={t('members', { count: group.memberCount })}
                trailing={
                  <span className="flex items-center gap-2">
                    <Badge variant={group.role === 'admin' ? 'info' : 'default'}>
                      {t(`roles.${group.role}`)}
                    </Badge>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </span>
                }
              />
            </Link>
          </li>
        ))}
      </ul>
      <div>{create}</div>
    </div>
  );
}
