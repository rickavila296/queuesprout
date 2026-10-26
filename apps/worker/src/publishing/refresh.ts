import { getFreshToken } from '@queuesprout/core/credentials';
import { listAccountsToRefresh } from '@queuesprout/db/credentials';
import { createCredentialStore } from '../credentials';
import type { PipelineDeps } from './step';

/** Refresh tokens this far ahead of expiry, so publish steps rarely need to. */
export const REFRESH_AHEAD_MS = 30 * 60_000;

export interface RefreshSummary {
  refreshed: number;
  needsReauth: number;
  failed: number;
}

/** The token.refresh job: refreshes every active login whose token expires soon. */
export async function refreshExpiringTokens(deps: PipelineDeps): Promise<RefreshSummary> {
  const now = deps.now();
  const accounts = await listAccountsToRefresh(deps.db, new Date(now.getTime() + REFRESH_AHEAD_MS));
  const summary: RefreshSummary = { refreshed: 0, needsReauth: 0, failed: 0 };

  for (const account of accounts) {
    const resolved = deps.pickAdapter({
      provider: account.provider,
      workspaceIsSandbox: account.workspaceIsSandbox,
    });
    if (!resolved.ok) continue;
    const { adapter } = resolved;
    try {
      const result = await getFreshToken({
        store: createCredentialStore(deps.db),
        keyring: deps.keyring,
        accountId: account.accountId,
        account,
        refresh: (creds) =>
          adapter.refreshToken(creds, AbortSignal.timeout(30_000), {
            externalId: account.externalAccountId,
            serviceUrl: account.serviceUrl,
          }),
        now: deps.now,
        skewMs: REFRESH_AHEAD_MS,
      });
      if (result.ok) summary.refreshed += result.refreshed ? 1 : 0;
      else if (result.error === 'needs_reauth') summary.needsReauth++;
      else summary.failed++;
    } catch (error) {
      summary.failed++;
      deps.log.warn({ accountId: account.accountId, err: (error as Error).name }, 'refresh failed');
    }
  }
  return summary;
}
