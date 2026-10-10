import type { MarkAllReadResponse } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { NoticeRepository } from './ports/notice-repository';

export class MarkAllNoticesRead {
  constructor(private readonly notices: NoticeRepository) {}

  async execute(scope: AccessScope<'write'>): Promise<MarkAllReadResponse> {
    return { updated: await this.notices.markAllRead(scope) };
  }
}
