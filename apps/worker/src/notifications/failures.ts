import { renderFailureEmail } from '@queuesprout/core/notifications';
import type { Database } from '@queuesprout/db';
import { listUnnotifiedFailureGroups, notifyFailureGroup } from '@queuesprout/db/publishing';
import { providerLabel } from '@queuesprout/shared';
import type { Mailer } from './mailer';

/** A group is emailed once it has been quiet this long, so channels failing together share one email. */
export const SETTLE_MS = 60_000;

export interface FailureEmailDeps {
  db: Database;
  mail: Mailer;
  publicUrl: string;
  now: () => Date;
  log: { error(obj: object, msg: string): void };
}

export interface FailureSweep {
  sent: number;
  skipped: number;
  errors: number;
}

/** One sweep: an email per post group with failures nobody has been told about. */
export async function sendFailureEmails(deps: FailureEmailDeps): Promise<FailureSweep> {
  const settledBefore = new Date(deps.now().getTime() - SETTLE_MS);
  const groups = await listUnnotifiedFailureGroups(deps.db, settledBefore);
  const summary: FailureSweep = { sent: 0, skipped: 0, errors: 0 };
  const origin = deps.publicUrl.replace(/\/+$/, '');

  for (const groupId of groups) {
    try {
      const result = await notifyFailureGroup(deps.db, groupId, settledBefore, async (notice) => {
        const email = renderFailureEmail({
          workspaceName: notice.workspace.name,
          postUrl: `${origin}/w/${encodeURIComponent(notice.workspace.slug)}/posts/${groupId}`,
          excerpt: notice.excerpt,
          failures: notice.failures.map((f) => ({
            ...f,
            providerLabel: providerLabel(f.provider),
          })),
        });
        await deps.mail({
          ...email,
          to: notice.recipients.map((r) => r.email),
          idempotencyKey: notice.idempotencyKey,
        });
      });
      if (result === 'sent') summary.sent += 1;
      else if (result !== 'none') summary.skipped += 1;
    } catch (error) {
      // Not marked: the next sweep tries again.
      summary.errors += 1;
      deps.log.error({ err: error, groupId }, 'failure email not sent');
    }
  }
  return summary;
}
