import type { Route } from 'next';
import Link from 'next/link';
import type { PublishHistory } from '@queuesprout/db';
import type { PostStatus, ProviderId, PublishErrorKind } from '@queuesprout/shared';
import { ProviderMark } from '@/app/w/[slug]/channels/provider-mark';
import { PostStatusDot } from '@/components/post-status';
import { isOverdue } from '@/lib/post-timing';
import { providerLabel } from '@/lib/providers';
import { RetryForm } from './retry-form';

export interface DeliveryPost {
  id: string;
  channel: string;
  provider: ProviderId | null;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  externalUrl: string | null;
  errorMessage: string | null;
  items: string[];
  history: (PublishHistory & { attemptTotal: number }) | undefined;
}

const OUTCOME: Record<string, string> = {
  success: 'Published',
  pending: 'Waiting on the platform',
  retryable_error: 'Failed, retried',
  fatal_error: 'Failed',
  unknown: 'Unknown result',
};

function hint(kind: PublishErrorKind | null, platform: string): string | null {
  switch (kind) {
    case 'auth':
      return 'Reconnect the account on the Channels page, then retry.';
    case 'unknown':
      return `This may already be on ${platform}. Look there before retrying, or it could post twice.`;
    case 'rate_limit':
    case 'transient':
      return `${platform} kept failing. Retrying sends it again now.`;
    case 'validation':
      return `${platform} refused this post. Retrying sends the same text again.`;
    case 'expired':
      return `${platform} took too long to process it. Retrying starts over.`;
    default:
      return null;
  }
}

export function DeliveryList({
  posts,
  timezone,
  workspaceSlug,
  groupId,
  canRetry,
  showText,
  now,
}: {
  posts: DeliveryPost[];
  timezone: string;
  workspaceSlug: string;
  groupId: string;
  canRetry: boolean;
  /** Request time, for flagging posts that are past due. */
  now: Date;
  /** Show each post's text; the composer above already shows it when editable. */
  showText: boolean;
}) {
  const at = (d: Date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);

  return (
    <ul className="flex flex-col gap-4">
      {posts.map((p) => {
        const platform = p.provider ? providerLabel(p.provider) : 'the platform';
        const kind = p.history?.errorKind ?? null;
        const when = p.publishedAt ?? p.scheduledAt;
        const items = p.history?.items ?? [];
        const thread = items.length > 1;
        return (
          <li key={p.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {p.provider && <ProviderMark provider={p.provider} />}
              <span className="font-medium">{p.channel}</span>
              <PostStatusDot status={p.status} overdue={isOverdue(p, now)} />
              {when && (
                <span className="text-xs text-muted">
                  {p.publishedAt ? 'Published' : 'For'} {at(when)}
                </span>
              )}
              {p.externalUrl && !thread && (
                <a className="text-sm text-sprout-600 underline" href={p.externalUrl}>
                  View on {platform}
                </a>
              )}
            </div>

            {p.status === 'failed' && (
              <div className="flex flex-col gap-2 rounded-sm border border-danger p-2">
                {p.errorMessage && <p className="text-sm text-danger">{p.errorMessage}</p>}
                {hint(kind, platform) && (
                  <p className="text-sm text-muted">
                    {hint(kind, platform)}{' '}
                    {kind === 'auth' && (
                      <Link
                        className="text-sprout-600 underline"
                        href={`/w/${workspaceSlug}/channels` as Route}
                      >
                        Channels
                      </Link>
                    )}
                  </p>
                )}
                {canRetry && (
                  <RetryForm
                    workspaceSlug={workspaceSlug}
                    groupId={groupId}
                    postId={p.id}
                    platform={platform}
                    mayHavePosted={kind === 'unknown'}
                  />
                )}
              </div>
            )}

            {(thread || showText) && (
              <ol className="flex flex-col gap-2">
                {p.items.map((body, i) => {
                  const item = items.find((r) => r.position === i);
                  return (
                    <li key={i} className="flex flex-col gap-1">
                      {thread && (
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>Part {i + 1}</span>
                          <span>·</span>
                          <span className={item?.status === 'failed' ? 'text-danger' : undefined}>
                            {item?.status === 'published'
                              ? 'Published'
                              : item?.status === 'failed'
                                ? 'Failed'
                                : 'Not sent yet'}
                          </span>
                          {item?.externalUrl && (
                            <a className="text-sprout-600 underline" href={item.externalUrl}>
                              View
                            </a>
                          )}
                        </p>
                      )}
                      {showText && (
                        <p className="whitespace-pre-wrap rounded-sm bg-surface p-2 text-sm">
                          {body}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {p.history && p.history.attemptTotal > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  Attempt history ({p.history.attemptTotal})
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">#</th>
                        <th className="py-1 pr-3 font-medium">Started</th>
                        {thread && <th className="py-1 pr-3 font-medium">Part</th>}
                        <th className="py-1 pr-3 font-medium">Result</th>
                        <th className="py-1 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.history.attempts.map((a) => (
                        <tr key={a.attemptNo} className="border-t border-border">
                          <td className="py-1 pr-3">{a.attemptNo}</td>
                          <td className="py-1 pr-3 whitespace-nowrap">{at(a.startedAt)}</td>
                          {thread && (
                            <td className="py-1 pr-3">
                              {a.position === null ? '–' : a.position + 1}
                            </td>
                          )}
                          <td className="py-1 pr-3">
                            {a.outcome ? (OUTCOME[a.outcome] ?? a.outcome) : 'Running'}
                          </td>
                          <td className="py-1 text-muted">
                            {[a.errorKind, a.httpStatus ? `HTTP ${a.httpStatus}` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
