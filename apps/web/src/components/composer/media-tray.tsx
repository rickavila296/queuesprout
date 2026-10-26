'use client';

import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import { MAX_ALT_TEXT_CHARS, type ItemMedia } from '@queuesprout/shared';
import { Button, cn, Input, Label } from '@queuesprout/ui';
import { UploadButton } from '@/app/w/[slug]/media/upload-button';
import type { ComposerMedia } from '@/lib/media';

interface Props {
  workspaceSlug: string;
  idPrefix: string;
  attached: ItemMedia[];
  /** Takes an updater, so several uploads finishing in a row each see the latest list. */
  onChange: (update: (prev: ItemMedia[]) => ItemMedia[]) => void;
  library: ComposerMedia[];
  canUpload: boolean;
}

function Thumb({ media, className }: { media: ComposerMedia | undefined; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-sm bg-surface-hover text-xs text-muted',
        className,
      )}
    >
      {media?.previewUrl ? (
        // Presigned bucket URLs expire, so next/image's cache would only get in the way.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <span className="p-1 text-center">{media ? 'Uploading' : 'No preview'}</span>
      )}
    </div>
  );
}

/** Attachments of one thread item: thumbnails with alt text, plus a picker and uploads. */
export function MediaTray({
  workspaceSlug,
  idPrefix,
  attached,
  onChange,
  library,
  canUpload,
}: Props) {
  const [picking, setPicking] = useState(false);
  const byId = new Map(library.map((m) => [m.id, m]));
  const attachedIds = new Set(attached.map((m) => m.mediaId));
  const choices = library.filter((m) => !attachedIds.has(m.id));

  const add = (mediaId: string) =>
    onChange((prev) =>
      prev.some((m) => m.mediaId === mediaId) ? prev : [...prev, { mediaId, altText: '' }],
    );

  return (
    <div className="flex flex-col gap-2">
      {attached.length > 0 && (
        <ul className="flex flex-col gap-2">
          {attached.map((m, i) => {
            const media = byId.get(m.mediaId);
            const altId = `${idPrefix}-alt-${i}`;
            return (
              <li key={m.mediaId} className="flex items-start gap-3">
                <Thumb media={media} className="size-16 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label htmlFor={altId} className="text-xs">
                    Alt text for {media?.filename ?? 'this image'}
                  </Label>
                  <Input
                    id={altId}
                    value={m.altText}
                    maxLength={MAX_ALT_TEXT_CHARS}
                    placeholder="Describe the image for people using screen readers"
                    onChange={(e) => {
                      const altText = e.target.value;
                      onChange((prev) =>
                        prev.map((a) => (a.mediaId === m.mediaId ? { ...a, altText } : a)),
                      );
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${media?.filename ?? 'image'}`}
                  onClick={() => onChange((prev) => prev.filter((a) => a.mediaId !== m.mediaId))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          <ImagePlus className="size-3.5" aria-hidden="true" />
          {picking ? 'Done adding images' : 'Add images'}
        </Button>
      </div>

      {picking && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          {canUpload && (
            <div className="flex justify-start">
              <UploadButton workspaceSlug={workspaceSlug} retention="auto" onUploaded={add} />
            </div>
          )}
          {choices.length === 0 ? (
            <p className="text-sm text-muted">
              {library.length === 0 ? 'No images in the library yet.' : 'All images are attached.'}
            </p>
          ) : (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Media library">
              {choices.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => add(m.id)}
                    className="block w-full rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-sprout-600"
                    aria-label={`Attach ${m.filename}`}
                    title={m.filename}
                  >
                    <Thumb media={m} className="aspect-square w-full" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
