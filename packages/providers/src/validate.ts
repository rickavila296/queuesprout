import { countChars, type PlatformLimits } from '@queuesprout/shared';
import type { z } from 'zod';
import type { ChannelPost, ValidationIssue } from './contract';

/**
 * Checks every adapter shares: thread length, text length and media count per item.
 * Adapters call this from validate() and add their platform's own rules.
 */
export function validateText(
  post: ChannelPost<unknown>,
  limits: PlatformLimits,
  capabilities: { threads: boolean; firstComment: boolean; media?: boolean },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const replies = post.items.filter((i) => i.kind === 'reply');
  const firstComments = post.items.filter((i) => i.kind === 'first_comment');

  if (post.items.length === 0 || post.items[0]?.kind !== 'post') {
    issues.push({ code: 'missing_post', message: 'The post has no main item.', severity: 'error' });
  }
  if (replies.length > 0 && !capabilities.threads) {
    issues.push({
      code: 'threads_unsupported',
      message: 'This channel does not support threads.',
      severity: 'error',
    });
  } else if (post.items.length > limits.maxThreadItems && capabilities.threads) {
    issues.push({
      code: 'thread_too_long',
      message: `Threads can have at most ${limits.maxThreadItems} posts here.`,
      severity: 'error',
    });
  }
  if (firstComments.length > 0 && !capabilities.firstComment) {
    issues.push({
      code: 'first_comment_unsupported',
      message: 'This channel does not support a first comment.',
      severity: 'error',
    });
  }

  for (const item of post.items) {
    const length = countChars(item.body, limits.countMode);
    if (length > limits.maxChars) {
      issues.push({
        code: 'text_too_long',
        message: `${length} of ${limits.maxChars} characters.`,
        severity: 'error',
        itemPosition: item.position,
        field: 'body',
      });
    }
    if (item.body.trim() === '' && item.mediaIds.length === 0) {
      issues.push({
        code: 'empty',
        message: 'Add text or media.',
        severity: 'error',
        itemPosition: item.position,
        field: 'body',
      });
    }
    if (item.mediaIds.length > 0 && !capabilities.media) {
      issues.push({
        code: 'media_unsupported',
        message: 'Images cannot be published to this channel yet.',
        severity: 'error',
        itemPosition: item.position,
        field: 'media',
      });
    } else if (item.mediaIds.length > limits.maxMedia) {
      issues.push({
        code: 'too_many_media',
        message:
          limits.maxMedia === 0
            ? 'This channel takes text only.'
            : `At most ${limits.maxMedia} attachments.`,
        severity: 'error',
        itemPosition: item.position,
        field: 'media',
      });
    }
  }
  return issues;
}

/** Turns a settings schema failure into validation issues. */
export function validateSettings(schema: z.ZodType, settings: unknown): ValidationIssue[] {
  const parsed = schema.safeParse(settings);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    code: 'invalid_setting',
    message: issue.message,
    severity: 'error' as const,
    field: issue.path.join('.') || 'settings',
  }));
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');
