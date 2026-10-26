import type { PublishCheckpoint, PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { fetchFresh } from '../net';
import { SlackError, toStepError } from './errors';
import { slack } from './http';
import {
  FILE_READY_POLL_MS,
  FILE_READY_TRIES,
  IMAGE_SPEC,
  SECTION_CHARS,
  UPLOAD_HOST,
} from './limits';
import type { SlackSettings } from './settings';
import { validateSlack } from './validate';

interface PostMessageResponse {
  channel: string;
  ts: string;
}

/**
 * Slack reads <…> as links and mentions (<!channel>, <@U123>). Escaping &, < and > keeps
 * the post exactly as written and means a post can never ping @channel or @everyone.
 */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** https://<workspace>.slack.com/archives/<channel>/p<ts without the dot>, threads included. */
export function permalink(
  workspaceUrl: string | null,
  channel: string,
  ts: string,
  threadTs?: string,
): string {
  if (!workspaceUrl) return '';
  const base = workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`;
  const url = `${base}archives/${channel}/p${ts.replace('.', '')}`;
  return threadTs ? `${url}?thread_ts=${threadTs}&cid=${channel}` : url;
}

/** Checkpoint stage once an item's images are uploaded; childContainerIds holds their file ids. */
const FILES_UPLOADED = 'files_uploaded';

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * Uploads the item's images as private files (getUploadURLExternal, the bytes, then
 * completeUploadExternal with no channel), so the message can show them in image blocks.
 */
async function uploadFiles(
  ctx: PublishContext<SlackSettings>,
): Promise<{ fileIds: string[] } | { error: StepError }> {
  const token = ctx.creds.accessToken;
  const call = { signal: ctx.signal, now: ctx.now };
  const files: { id: string; title: string }[] = [];
  for (const [i, mediaId] of ctx.item.mediaIds.entries()) {
    const got = await ctx.media.getFile(mediaId, IMAGE_SPEC);
    if (!got.ok) {
      return {
        error: {
          kind: 'error',
          errorKind: got.retryable ? 'transient' : 'validation',
          message: got.message,
        },
      };
    }
    const filename = `image-${i + 1}.${got.file.mime.split('/')[1] ?? 'jpg'}`;
    const alt = ctx.item.altTexts?.[i];
    const target = await slack<{ upload_url: string; file_id: string }>(
      token,
      'files.getUploadURLExternal',
      {
        body: { filename, length: got.file.bytes.byteLength, ...(alt && { alt_txt: alt }) },
        ...call,
      },
    );
    const url = new URL(target.upload_url);
    if (url.protocol !== 'https:' || url.hostname !== UPLOAD_HOST) {
      throw new SlackError(502, 'unexpected_upload_url');
    }
    const { res } = await fetchFresh(url.toString(), {
      method: 'POST',
      headers: { 'content-type': got.file.mime },
      body: new Uint8Array(got.file.bytes),
      signal: ctx.signal,
      redirect: 'error',
    });
    if (!res.ok) throw new SlackError(res.status, `upload_http_${res.status}`);
    files.push({ id: target.file_id, title: filename });
  }
  await slack(token, 'files.completeUploadExternal', {
    body: { files: JSON.stringify(files) },
    ...call,
  });
  return { fileIds: files.map((f) => f.id) };
}

/** Section blocks for the text (each holds 3,000 characters), then one image block per file. */
export function imageBlocks(text: string, fileIds: string[], altTexts: string[] = []): unknown[] {
  const chars = [...text];
  const sections: unknown[] = [];
  for (let start = 0; start < chars.length; start += SECTION_CHARS) {
    const chunk = chars.slice(start, start + SECTION_CHARS).join('');
    if (chunk.trim() !== '')
      sections.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }
  return [
    ...sections,
    ...fileIds.map((id, i) => ({
      type: 'image',
      slack_file: { id },
      // Required by Slack; an image without a description gets a neutral one.
      alt_text: altTexts[i]?.trim() || 'Image',
    })),
  ];
}

/**
 * One step per item. Item 0 is a channel message; later items reply in its thread (Slack
 * threads are one level deep, so every reply hangs off the first message).
 *
 * With images: the files are uploaded first and their ids kept in the checkpoint. A file
 * Slack has not finished processing makes chat.postMessage answer invalid_blocks, so the
 * step returns pending and the next one posts again with the same files, never uploading
 * twice, up to FILE_READY_TRIES times.
 */
export async function publish(ctx: PublishContext<SlackSettings>): Promise<PublishStep> {
  // Issues about other items fail their own step, not this one.
  const blocking = validateSlack(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  let threadTs: string | undefined;
  if (ctx.item.position > 0) {
    const ts = ctx.root?.meta.ts;
    if (typeof ts !== 'string') {
      return {
        kind: 'error',
        errorKind: 'validation',
        message: 'The first message of this thread has no Slack reference.',
      };
    }
    threadTs = ts;
  }

  const noUnfurl = ctx.post.settings.disableUnfurl === true;
  const text = escapeText(ctx.item.body);
  let checkpoint: PublishCheckpoint | null = null;
  try {
    if (ctx.checkpoint?.stage === FILES_UPLOADED) {
      checkpoint = ctx.checkpoint;
    } else if (ctx.item.mediaIds.length > 0) {
      const uploaded = await uploadFiles(ctx);
      if ('error' in uploaded) return uploaded.error;
      checkpoint = {
        stage: FILES_UPLOADED,
        childContainerIds: uploaded.fileIds,
        startedAt: ctx.now().toISOString(),
        data: { tries: 0 },
      };
    }
    const fileIds = checkpoint?.childContainerIds ?? [];

    let message: PostMessageResponse;
    try {
      message = await slack<PostMessageResponse>(ctx.creds.accessToken, 'chat.postMessage', {
        body: {
          channel: ctx.target.externalId,
          // With blocks, text is only the notification fallback.
          text: text.trim() === '' && fileIds.length > 0 ? 'Image' : text,
          ...(fileIds.length > 0 && {
            blocks: JSON.stringify(imageBlocks(text, fileIds, ctx.item.altTexts)),
          }),
          ...(threadTs && { thread_ts: threadTs }),
          ...(noUnfurl && { unfurl_links: false, unfurl_media: false }),
        },
        signal: ctx.signal,
        now: ctx.now,
      });
    } catch (error) {
      if (checkpoint && error instanceof SlackError && error.code === 'invalid_blocks') {
        const tries = Number(checkpoint.data?.tries ?? 0) + 1;
        if (tries < FILE_READY_TRIES) {
          return {
            kind: 'pending',
            checkpoint: { ...checkpoint, data: { ...checkpoint.data, tries } },
            pollAfterMs: FILE_READY_POLL_MS,
          };
        }
      }
      throw error;
    }
    return {
      kind: 'done',
      externalId: message.ts,
      url: permalink(ctx.account.serviceUrl, message.channel, message.ts, threadTs),
      meta: { ts: message.ts, channel: message.channel },
    };
  } catch (error) {
    return toStepError(error);
  }
}
