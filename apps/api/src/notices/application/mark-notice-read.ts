import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Notice } from '../domain/notice';
import type { NoticeRepository } from './ports/notice-repository';

export class MarkNoticeRead {
  constructor(private readonly notices: NoticeRepository) {}

  async execute(scope: AccessScope<'write'>, id: string): Promise<Notice> {
    return notFoundUnlessAllowed(await this.notices.markRead(scope, id));
  }
}
