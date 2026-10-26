import type { Metadata } from 'next';
import { hasRole } from '@queuesprout/core';
import { getStorageUsage, listMedia, type MediaSummary } from '@queuesprout/db';
import { formatBytes, WORKSPACE_STORAGE_QUOTA_BYTES, type MediaStatus } from '@queuesprout/shared';
import { presignGet } from '@queuesprout/storage';
import { Badge, Card } from '@queuesprout/ui';
import { ConfirmButton } from '@/components/confirm-button';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { storage } from '@/lib/storage';
import { deleteMediaAction } from './actions';
import { UploadButton } from './upload-button';

export const metadata: Metadata = { title: 'Media' };

const STATUS: Record<
  MediaStatus,
  { label: string; tone: 'neutral' | 'success' | 'danger' | 'info' }
> = {
  uploading: { label: 'Uploading', tone: 'neutral' },
  processing: { label: 'Checking', tone: 'info' },
  ready: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  purged: { label: 'Expired', tone: 'neutral' },
};

/** Files whose bytes are in the bucket and can be previewed. */
const hasFile = (m: MediaSummary) => m.status === 'processing' || m.status === 'ready';

export default async function MediaPage({ params }: PageProps<'/w/[slug]/media'>) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const canEdit = hasRole(ctx.role, 'editor');
  const bucket = storage();

  const { media, used } = await dataAccess().withWorkspace(ctx, async (tx) => ({
    media: await listMedia(tx, ctx.workspaceId),
    used: await getStorageUsage(tx, ctx.workspaceId),
  }));
  const previews = new Map<string, string>();
  if (bucket) {
    await Promise.all(
      media.filter(hasFile).map(async (m) => {
        previews.set(m.id, await presignGet(bucket, m.thumbnailKey ?? m.storageKey));
      }),
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Media</h1>
          <p className="text-muted">
            {formatBytes(used)} of {formatBytes(WORKSPACE_STORAGE_QUOTA_BYTES)} used
          </p>
        </div>
        {canEdit && bucket && <UploadButton workspaceSlug={slug} retention="library" />}
      </div>

      {!bucket && (
        <Card>
          <p>
            Media storage is not set up. Set <code>S3_ENDPOINT</code>, <code>S3_BUCKET</code>,{' '}
            <code>S3_ACCESS_KEY_ID</code> and <code>S3_SECRET_ACCESS_KEY</code> in <code>.env</code>{' '}
            and restart.
          </p>
        </Card>
      )}

      {media.length === 0 ? (
        <Card>
          <p className="text-muted">
            No media yet. Upload JPEG, PNG, WebP or GIF images up to 20 MB to use them in posts.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => {
            const status = STATUS[m.status];
            const preview = previews.get(m.id);
            return (
              <li key={m.id}>
                <Card className="flex h-full flex-col gap-2 p-2">
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sm bg-surface-hover">
                    {preview ? (
                      // Presigned bucket URLs expire, so next/image's cache would only get in the way.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <span className="text-sm text-muted">{status.label}</span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-sm font-medium" title={m.filename}>
                      {m.filename}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span>{formatBytes(m.bytes)}</span>
                      {m.width && m.height && (
                        <span>
                          {m.width}×{m.height}
                        </span>
                      )}
                    </div>
                    {m.status === 'failed' && m.errorMessage && (
                      <p className="text-xs text-danger">{m.errorMessage}</p>
                    )}
                  </div>
                  {canEdit && (
                    <form action={deleteMediaAction}>
                      <input type="hidden" name="workspaceSlug" value={slug} />
                      <input type="hidden" name="mediaId" value={m.id} />
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        confirmText={`Delete ${m.filename}? Posts already scheduled with it keep it.`}
                      >
                        Delete
                      </ConfirmButton>
                    </form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
