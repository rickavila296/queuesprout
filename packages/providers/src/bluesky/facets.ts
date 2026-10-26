import { countChars } from '@queuesprout/shared';
import { MAX_TAG_GRAPHEMES } from './limits';

/**
 * Rich-text facets: Bluesky shows links, mentions and hashtags only when the record
 * marks them with UTF-8 byte ranges. Plain text is never changed.
 */

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: (
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  )[];
};

interface Span {
  start: number;
  end: number;
}

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;
const byteRange = (text: string, span: Span) => ({
  byteStart: bytes(text.slice(0, span.start)),
  byteEnd: bytes(text.slice(0, span.end)),
});

const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/** https:// and http:// URLs, without trailing punctuation or an unmatched ")". */
export function findLinks(text: string): (Span & { uri: string })[] {
  const out: (Span & { uri: string })[] = [];
  for (const m of text.matchAll(/(^|[\s(])(https?:\/\/[^\s]+)/gi)) {
    let uri = m[2] ?? '';
    uri = uri.replace(TRAILING_PUNCTUATION, '');
    if (uri.endsWith(')') && !uri.includes('(')) uri = uri.slice(0, -1);
    try {
      new URL(uri);
    } catch {
      continue;
    }
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    out.push({ start, end: start + uri.length, uri });
  }
  return out;
}

/** @handle.domain mentions. Handles without a dot are not handles. */
export function findMentions(text: string): (Span & { handle: string })[] {
  const out: (Span & { handle: string })[] = [];
  for (const m of text.matchAll(/(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z][a-zA-Z0-9-]*)/g)) {
    const handle = (m[2] ?? '').replace(/[.-]+$/, '');
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    out.push({ start, end: start + 1 + handle.length, handle: handle.toLowerCase() });
  }
  return out;
}

/** #hashtags: not all digits, no trailing punctuation, at most 64 graphemes. */
export function findTags(text: string): (Span & { tag: string })[] {
  const out: (Span & { tag: string })[] = [];
  for (const m of text.matchAll(/(^|\s)[#＃]([^\s#＃]+)/gu)) {
    const tag = (m[2] ?? '').replace(/\p{P}+$/u, '');
    if (!tag || /^\d+$/.test(tag) || countChars(tag, 'graphemes') > MAX_TAG_GRAPHEMES) continue;
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    out.push({ start, end: start + 1 + tag.length, tag });
  }
  return out;
}

/**
 * Builds the facets for a post. resolveHandle turns a handle into a DID and returns
 * null when it cannot; unresolved mentions stay plain text.
 */
export async function buildFacets(
  text: string,
  resolveHandle: (handle: string) => Promise<string | null>,
): Promise<Facet[]> {
  const facets: Facet[] = [];
  for (const link of findLinks(text)) {
    facets.push({
      index: byteRange(text, link),
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.uri }],
    });
  }
  const mentions = findMentions(text);
  const dids = new Map<string, string | null>();
  for (const handle of new Set(mentions.map((m) => m.handle))) {
    dids.set(handle, await resolveHandle(handle));
  }
  for (const mention of mentions) {
    const did = dids.get(mention.handle);
    if (!did) continue;
    facets.push({
      index: byteRange(text, mention),
      features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
    });
  }
  for (const tag of findTags(text)) {
    facets.push({
      index: byteRange(text, tag),
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.tag }],
    });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
