'use client';

import { useActionState } from 'react';
import { Button, FieldError } from '@queuesprout/ui';
import { retryPostAction } from './actions';

export function RetryForm({
  workspaceSlug,
  groupId,
  postId,
  platform,
  mayHavePosted,
}: {
  workspaceSlug: string;
  groupId: string;
  postId: string;
  platform: string;
  /** The last step's outcome is unknown, so the post may already be live. */
  mayHavePosted: boolean;
}) {
  const [state, action, pending] = useActionState(retryPostAction, null);
  const confirmId = `confirm-${postId}`;

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="postId" value={postId} />
      {mayHavePosted && (
        <label htmlFor={confirmId} className="flex items-start gap-2 text-sm">
          <input id={confirmId} type="checkbox" name="confirmUnknown" required className="mt-1" />
          <span>I checked {platform} and this post is not there.</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Retrying…' : 'Retry now'}
        </Button>
        {state?.ok && (
          <p role="status" className="text-sm text-success">
            Queued. It goes out within a minute.
          </p>
        )}
      </div>
      <FieldError>{state && !state.ok ? state.error : undefined}</FieldError>
    </form>
  );
}
