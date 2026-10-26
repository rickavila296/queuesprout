'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createUploadSchema, MEDIA_RETENTIONS, type MediaRetention } from '@queuesprout/shared';
import { Button, FieldError } from '@queuesprout/ui';
import { completeUploadAction, createUploadAction } from './actions';

interface Progress {
  name: string;
  percent: number;
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
}: {
  workspaceSlug: string;
  retention?: MediaRetention;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function uploadOne(file: File): Promise<string | null> {
    const parsed = createUploadSchema.safeParse({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      retention,
    });
    if (!parsed.success) return `${file.name}: ${parsed.error.issues[0]?.message ?? 'not allowed'}`;

    const ticket = await createUploadAction(workspaceSlug, parsed.data);
    if (!ticket.ok) return `${file.name}: ${ticket.error}`;
    setProgress({ name: file.name, percent: 0 });
    try {
      await putWithProgress(ticket.data.uploadUrl, file, ticket.data.contentType, (percent) =>
        setProgress({ name: file.name, percent }),
      );
    } catch (error) {
      return `${file.name}: ${(error as Error).message}`;
    }
    const done = await completeUploadAction(workspaceSlug, ticket.data.mediaId);
    return done.ok ? null : `${file.name}: ${done.error}`;
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErrors([]);
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      const error = await uploadOne(file);
      if (error) failed.push(error);
    }
    setProgress(null);
    setErrors(failed);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
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
        {progress ? `Uploading ${progress.percent}%` : 'Upload images'}
      </Button>
      {progress && (
        <p role="status" className="max-w-64 truncate text-sm text-muted">
          {progress.name}
        </p>
      )}
      {errors.map((e) => (
        <FieldError key={e}>{e}</FieldError>
      ))}
    </div>
  );
}
