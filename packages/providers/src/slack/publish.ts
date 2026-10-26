import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { slack } from './http';
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

/**
 * One step per item. Item 0 is a channel message; later items reply in its thread (Slack
 * threads are one level deep, so every reply hangs off the first message).
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
  try {
    const message = await slack<PostMessageResponse>(ctx.creds.accessToken, 'chat.postMessage', {
      body: {
        channel: ctx.target.externalId,
        text: escapeText(ctx.item.body),
        ...(threadTs && { thread_ts: threadTs }),
        ...(noUnfurl && { unfurl_links: false, unfurl_media: false }),
      },
      signal: ctx.signal,
      now: ctx.now,
    });
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
