import { Router } from 'express';

/** `commit` is the deployed commit, so a deploy can be checked from outside: its first 7 characters. */
export function healthRoutes(commit?: string): Router {
  const router = Router();
  const body =
    commit === undefined ? { status: 'ok' } : { status: 'ok', commit: commit.slice(0, 7) };
  router.get('/health', (_req, res) => {
    res.json(body);
  });
  return router;
}
