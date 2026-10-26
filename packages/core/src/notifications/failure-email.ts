import type { PublishErrorKind } from '@queuesprout/shared';

export interface FailureEmailInput {
  workspaceName: string;
  /** Absolute link to the post page. */
  postUrl: string;
  excerpt: string;
  failures: {
    channel: string;
    providerLabel: string;
    errorKind: PublishErrorKind | null;
    errorMessage: string | null;
  }[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const EXCERPT_CHARS = 140;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS - 1).join('')}…` : flat;
}

/** What to do next, by error kind. Mirrors the hints on the post page. */
const NEXT_STEPS: Partial<Record<PublishErrorKind, { hint: string; said: RegExp }>> = {
  auth: { hint: 'Reconnect the account, then retry.', said: /reconnect/i },
  unknown: {
    hint: 'It may have posted anyway. Check the platform before retrying.',
    said: /check (the|on the) platform|verify on platform/i,
  },
  validation: { hint: 'The platform refused the post.', said: /refused|rejected/i },
};
const RETRY_HINT = { hint: 'Retry it from the post page.', said: /\bretry/i };

/** The error, followed by what to do next unless the error already says it. */
function describe(kind: PublishErrorKind | null, message: string | null): string {
  const text = message ?? 'Failed.';
  const next = (kind && NEXT_STEPS[kind]) ?? RETRY_HINT;
  return next.said.test(text) ? text : `${text} ${next.hint}`;
}

/** The email sent when a post fails on one or more channels. Plain text and simple HTML. */
export function renderFailureEmail(input: FailureEmailInput): RenderedEmail {
  const n = input.failures.length;
  const where =
    n === 1
      ? `${input.failures[0]?.channel} (${input.failures[0]?.providerLabel})`
      : `${n} channels`;
  const subject = `Post failed on ${where}`;
  const excerpt = shorten(input.excerpt);

  const lines = input.failures.map(
    (f) => `- ${f.channel} (${f.providerLabel}): ${describe(f.errorKind, f.errorMessage)}`,
  );
  const text = [
    `A post in ${input.workspaceName} did not publish.`,
    '',
    excerpt ? `"${excerpt}"` : null,
    excerpt ? '' : null,
    ...lines,
    '',
    `See what happened and retry: ${input.postUrl}`,
    '',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const items = input.failures
    .map(
      (f) =>
        `<li><strong>${escapeHtml(f.channel)}</strong> (${escapeHtml(f.providerLabel)}): ${escapeHtml(describe(f.errorKind, f.errorMessage))}</li>`,
    )
    .join('');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#121614">
<h1 style="font-size:20px">A post did not publish</h1>
<p>A post in ${escapeHtml(input.workspaceName)} failed on ${escapeHtml(where)}.</p>
${excerpt ? `<p style="color:#5D6661">“${escapeHtml(excerpt)}”</p>` : ''}
<ul>${items}</ul>
<p><a href="${escapeHtml(input.postUrl)}" style="display:inline-block;background:#23804A;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">See what happened and retry</a></p>
</div>`;
  return { subject, text, html };
}
