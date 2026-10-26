import type { PublishStep } from '@queuesprout/shared';
import type { ItemRef, PublishContext } from '../contract';
import { toStepError, XrpcError } from './errors';
import { buildFacets } from './facets';
import { ENTRYWAY_URL, IMAGE_SPEC, POST_COLLECTION, POST_WEB_URL } from './limits';
import type { BlueskySettings } from './settings';
import { validateBluesky } from './validate';
import { xrpc } from './xrpc';

/**
 * One step per item: upload its images as blobs, create the post record (with a reply
 * ref for thread items) and return done. Bluesky has no async processing, so this never
 * returns pending. Blobs nothing references are garbage-collected by the PDS, so a retry
 * that uploads them again leaves nothing behind.
 *
 * Never double-post: the record key is derived from the item (its id and stored time),
 * so a retry after a timeout tries to create the same record again. If it exists, the
 * step reads it back and reports done instead of posting twice.
 */

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A valid TID (13 base32-sortable chars: 53 bits of microseconds, 10 bits of clock id)
 * that is the same every time for the same item.
 */
export function itemRecordKey(item: { id: string; createdAt?: Date }, fallback: Date): string {
  const hash = fnv1a(item.id);
  const micros = BigInt((item.createdAt ?? fallback).getTime()) * 1000n + BigInt(hash % 1000);
  let value = (micros << 10n) | BigInt((hash >>> 10) % 1024);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = (TID_ALPHABET[Number(value & 31n)] ?? '2') + out;
    value >>= 5n;
  }
  return out;
}

interface StrongRef {
  uri: string;
  cid: string;
}

function strongRef(ref: ItemRef | null): StrongRef | null {
  const uri = ref?.meta.uri;
  const cid = ref?.meta.cid;
  return typeof uri === 'string' && typeof cid === 'string' ? { uri, cid } : null;
}

export const postUrl = (did: string, rkey: string) => `${POST_WEB_URL}/${did}/post/${rkey}`;

type StepError = Extract<PublishStep, { kind: 'error' }>;
type Call = { service: string; token: string; signal: AbortSignal; now: () => Date };

/** app.bsky.embed.images for the item's attachments, or an error to end the step with. */
async function uploadImages(
  ctx: PublishContext<BlueskySettings>,
  call: Call,
): Promise<{ embed: Record<string, unknown> | undefined } | { error: StepError }> {
  const images: Record<string, unknown>[] = [];
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
    const uploaded = await xrpc<{ blob: Record<string, unknown> }>('POST', {
      ...call,
      nsid: 'com.atproto.repo.uploadBlob',
      blob: { bytes: got.file.bytes, contentType: got.file.mime },
    });
    images.push({
      alt: ctx.item.altTexts?.[i] ?? '',
      image: uploaded.blob,
      aspectRatio: { width: got.file.width, height: got.file.height },
    });
  }
  return {
    embed: images.length > 0 ? { $type: 'app.bsky.embed.images', images } : undefined,
  };
}

export async function publish(ctx: PublishContext<BlueskySettings>): Promise<PublishStep> {
  // Issues about other items fail their own step, not this one.
  const blocking = validateBluesky(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  let reply: { root: StrongRef; parent: StrongRef } | undefined;
  if (ctx.item.position > 0) {
    const root = strongRef(ctx.root);
    const parent = strongRef(ctx.parent);
    if (!root || !parent) {
      return {
        kind: 'error',
        errorKind: 'validation',
        message: 'The previous post in this thread has no Bluesky reference.',
      };
    }
    reply = { root, parent };
  }

  const service = ctx.account.serviceUrl ?? ENTRYWAY_URL;
  const repo = ctx.account.externalId;
  const rkey = itemRecordKey(ctx.item, ctx.now());
  const call = { service, token: ctx.creds.accessToken, signal: ctx.signal, now: ctx.now };

  try {
    const uploaded = await uploadImages(ctx, call);
    if ('error' in uploaded) return uploaded.error;
    const facets = await buildFacets(ctx.item.body, async (handle) => {
      try {
        const res = await xrpc<{ did: string }>('GET', {
          ...call,
          nsid: 'com.atproto.identity.resolveHandle',
          params: { handle },
        });
        return res.did;
      } catch {
        return null;
      }
    });
    const record = {
      $type: POST_COLLECTION,
      text: ctx.item.body,
      createdAt: ctx.now().toISOString(),
      ...(facets.length > 0 && { facets }),
      ...(reply && { reply }),
      ...(uploaded.embed && { embed: uploaded.embed }),
      ...(ctx.post.settings.langs?.length && { langs: ctx.post.settings.langs }),
    };

    let created: StrongRef;
    try {
      created = await xrpc<StrongRef>('POST', {
        ...call,
        nsid: 'com.atproto.repo.createRecord',
        body: { repo, collection: POST_COLLECTION, rkey, record },
      });
    } catch (error) {
      // A 4xx may mean an earlier attempt already created this record.
      const existing =
        error instanceof XrpcError && error.status === 400
          ? await findExisting(call, repo, rkey, ctx.item.body)
          : null;
      if (!existing) throw error;
      created = existing;
    }
    return {
      kind: 'done',
      externalId: created.uri,
      url: postUrl(repo, rkey),
      meta: { uri: created.uri, cid: created.cid },
    };
  } catch (error) {
    return toStepError(error);
  }
}

async function findExisting(
  call: Call,
  repo: string,
  rkey: string,
  text: string,
): Promise<StrongRef | null> {
  try {
    const res = await xrpc<{ uri: string; cid?: string; value?: { text?: unknown } }>('GET', {
      ...call,
      nsid: 'com.atproto.repo.getRecord',
      params: { repo, collection: POST_COLLECTION, rkey },
    });
    return res.cid && res.value?.text === text ? { uri: res.uri, cid: res.cid } : null;
  } catch {
    return null;
  }
}
