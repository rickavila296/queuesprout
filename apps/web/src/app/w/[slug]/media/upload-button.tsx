'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createUploadSchema, MEDIA_RETENTIONS, type MediaRetention } from '@queuesprout/shared';
import { Button, FieldError } from '@queuesprout/ui';
import { completeUploadAction, createUploadAction } from './actions';

interface Progress {
  name: string;
  /** 1-based position of this file in the batch. */
  index: number;
  total: number;
  percent: number;
  /** The bytes are in; the server is confirming the upload. */
  finishing: boolean;
}

/** PUTs straight to the bucket so the bytes never pass through a server function. */
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage refused the upload (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection.'));
    xhr.send(file);
  });
}

export function UploadButton({
  workspaceSlug,
  retention = MEDIA_RETENTIONS[0],
  onUploaded,
}: {
  workspaceSlug: string;
  retention?: MediaRetention;
  /** Called with each file that finished uploading, e.g. to attach it in the composer. */
  onUploaded?: (mediaId: string) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function uploadOne(file: File, index: number, total: number): Promise<string | null> {
    const parsed = createUploadSchema.safeParse({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      retention,
    });
    if (!parsed.success) return `${file.name}: ${parsed.error.issues[0]?.message ?? 'not allowed'}`;

    const ticket = await createUploadAction(workspaceSlug, parsed.data);
    if (!ticket.ok) return `${file.name}: ${ticket.error}`;
    const at = { name: file.name, index, total };
    setProgress({ ...at, percent: 0, finishing: false });
    try {
      await putWithProgress(ticket.data.uploadUrl, file, ticket.data.contentType, (percent) =>
        setProgress({ ...at, percent, finishing: false }),
      );
    } catch (error) {
      return `${file.name}: ${(error as Error).message}`;
    }
    setProgress({ ...at, percent: 100, finishing: true });
    const done = await completeUploadAction(workspaceSlug, ticket.data.mediaId);
    if (!done.ok) return `${file.name}: ${done.error}`;
    onUploaded?.(done.data.mediaId);
    return null;
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErrors([]);
    const failed: string[] = [];
    const list = Array.from(files);
    for (const [i, file] of list.entries()) {
      const error = await uploadOne(file, i + 1, list.length);
      if (error) failed.push(error);
    }
    setProgress(null);
    setErrors(failed);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="sr-only"
        aria-label="Choose images to upload"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <Button type="button" onClick={() => input.current?.click()} disabled={progress !== null}>
        <Upload className="size-4" aria-hidden="true" />
        {progress
          ? progress.finishing
            ? 'Finishing…'
            : `Uploading ${progress.percent}%`
          : 'Upload images'}
      </Button>
      {progress && (
        <div className="flex w-64 flex-col gap-1">
          <div
            role="progressbar"
            aria-label={`Uploading ${progress.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p role="status" className="truncate text-sm text-muted">
            {progress.total > 1 && `${progress.index} of ${progress.total}: `}
            {progress.name}
          </p>
        </div>
      )}
      {errors.map((e) => (
        <FieldError key={e}>{e}</FieldError>
      ))}
    </div>
  );
}
