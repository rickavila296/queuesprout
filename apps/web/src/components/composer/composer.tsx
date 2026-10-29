'use client';

import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import {
  MAX_THREAD_ITEMS,
  type ComposeInput,
  type ComposeMode,
  type ItemMedia,
  type ProviderId,
} from '@queuesprout/shared';
import { Badge, Button, Card, cn, FieldError, Input, Label, Textarea } from '@queuesprout/ui';
import { saveComposeAction } from '@/app/w/[slug]/compose/actions';
import { charCount, validateThread } from '@/lib/compose';
import type { ComposerMedia } from '@/lib/media';
import { providerLabel } from '@/lib/providers';
import { MediaTray } from './media-tray';

export interface ComposerChannel {
  id: string;
  provider: ProviderId;
  name: string;
  handle: string | null;
  defaultSettings: Record<string, unknown>;
  /** Why it cannot be picked, when it cannot. */
  unavailable: string | null;
}

export interface ComposerInitial {
  groupId?: string;
  baseItems: string[];
  /** Base attachments by item position. */
  baseMedia: ItemMedia[][];
  /**
   * Editable posts already in the group. items is null when the channel follows the base;
   * media is the override's attachments by item position.
   */
  picks: { channelId: string; items: string[] | null; media: ItemMedia[][]; version?: number }[];
  /** Posts in the group that can no longer change (publishing, published, failed). */
  frozen: { channelId: string; status: string; externalUrl: string | null }[];
  mode: ComposeMode;
  scheduledAt: string;
}

interface Props {
  workspaceSlug: string;
  timezone: string;
  channels: ComposerChannel[];
  initial: ComposerInitial;
  /** Images that can be attached, newest first. */
  library: ComposerMedia[];
  /** False when media storage is not configured. */
  canUpload: boolean;
}

type MediaUpdate = (prev: ItemMedia[]) => ItemMedia[];

const setAt = <T,>(list: T[][], i: number, update: (prev: T[]) => T[]): T[][] => {
  const next = Array.from({ length: Math.max(list.length, i + 1) }, (_, j) => list[j] ?? []);
  next[i] = update(next[i] ?? []);
  return next;
};

type Tab = 'base' | string;

const MODE_LABEL: Record<ComposeMode, string> = {
  draft: 'Save draft',
  schedule: 'Schedule',
  now: 'Publish now',
};

export function Composer({
  workspaceSlug,
  timezone,
  channels,
  initial,
  library,
  canUpload,
}: Props) {
  const [state, action, pending] = useActionState(saveComposeAction, null);
  const [base, setBase] = useState<string[]>(initial.baseItems);
  const [baseMedia, setBaseMedia] = useState<ItemMedia[][]>(initial.baseMedia);
  const [overrideMedia, setOverrideMedia] = useState<Record<string, ItemMedia[][]>>(() =>
    Object.fromEntries(
      initial.picks.flatMap((p) => (p.items ? [[p.channelId, p.media] as const] : [])),
    ),
  );
  const [picked, setPicked] = useState<string[]>(initial.picks.map((p) => p.channelId));
  const [overrides, setOverrides] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      initial.picks.flatMap((p) => (p.items ? [[p.channelId, p.items] as const] : [])),
    ),
  );
  const versions = useMemo(
    () => new Map(initial.picks.map((p) => [p.channelId, p.version])),
    [initial.picks],
  );
  const [tab, setTab] = useState<Tab>('base');
  const [mode, setMode] = useState<ComposeMode>(initial.mode);
  const [scheduledAt, setScheduledAt] = useState(initial.scheduledAt);

  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const frozenIds = new Set(initial.frozen.map((f) => f.channelId));
  const pickedChannels = picked.flatMap((id) => byId.get(id) ?? []);
  const itemsFor = (id: string) => overrides[id] ?? base;
  const mediaFor = (id: Tab) =>
    id === 'base' || !overrides[id] ? baseMedia : (overrideMedia[id] ?? []);

  const issues = new Map(
    pickedChannels.map((c) => [c.id, validateThread(c, itemsFor(c.id), mediaFor(c.id))]),
  );
  const blocking = [...issues.values()].some((list) => list.some((i) => i.severity === 'error'));
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const activeTab = tab !== 'base' && !picked.includes(tab) ? 'base' : tab;

  const payload: ComposeInput = {
    workspaceSlug,
    ...(initial.groupId && { groupId: initial.groupId }),
    baseItems: base,
    baseMedia: baseMedia.slice(0, base.length),
    channels: picked.map((channelId) => ({
      channelId,
      items: overrides[channelId] ?? null,
      media: overrides[channelId]
        ? (overrideMedia[channelId] ?? []).slice(0, overrides[channelId].length)
        : [],
      ...(versions.get(channelId) !== undefined && { version: versions.get(channelId) }),
    })),
    mode,
    ...(mode !== 'now' && scheduledAt && { scheduledAt }),
  };

  const toggle = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const editThread = (target: Tab, next: string[]) => {
    if (target === 'base') setBase(next);
    else setOverrides((o) => ({ ...o, [target]: next }));
  };

  const editMedia = (target: Tab, i: number, update: MediaUpdate) => {
    if (target === 'base') setBaseMedia((m) => setAt(m, i, update));
    else setOverrideMedia((o) => ({ ...o, [target]: setAt(o[target] ?? [], i, update) }));
  };

  const removeItem = (target: Tab, i: number, items: string[]) => {
    editThread(
      target,
      items.filter((_, j) => j !== i),
    );
    const drop = (list: ItemMedia[][]) => list.filter((_, j) => j !== i);
    if (target === 'base') setBaseMedia(drop);
    else setOverrideMedia((o) => ({ ...o, [target]: drop(o[target] ?? []) }));
  };

  const thread = activeTab === 'base' ? base : overrides[activeTab];
  const activeChannel = activeTab === 'base' ? null : byId.get(activeTab);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Channels</legend>
        {channels.length === 0 ? (
          <p className="text-muted">
            No channels yet. Add one on the{' '}
            <Link className="text-link underline" href={`/w/${workspaceSlug}/channels` as '/'}>
              Channels
            </Link>{' '}
            page.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {channels
              .filter((c) => !frozenIds.has(c.id))
              .map((c) => {
                const on = picked.includes(c.id);
                const disabled = c.unavailable !== null && !on;
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex h-8 cursor-pointer items-center gap-2 rounded-sm border px-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-focus',
                        on
                          ? 'border-primary bg-selected text-text'
                          : 'border-border bg-bg hover:bg-surface-hover',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                      title={c.unavailable ?? undefined}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        disabled={disabled}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted">{providerLabel(c.provider)}</span>
                    </label>
                  </li>
                );
              })}
          </ul>
        )}
        <FieldError>{errors?.channels}</FieldError>
      </fieldset>

      {initial.frozen.length > 0 && (
        <Card className="flex flex-col gap-1 text-sm">
          <p className="font-medium">Already on its way</p>
          {initial.frozen.map((f) => {
            const c = byId.get(f.channelId);
            return (
              <p key={f.channelId} className="text-muted">
                {c ? `${c.name} (${providerLabel(c.provider)})` : 'Removed channel'}: {f.status}
                {f.externalUrl && (
                  <>
                    {' · '}
                    <a className="text-link underline" href={f.externalUrl}>
                      View post
                    </a>
                  </>
                )}
              </p>
            );
          })}
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Edit text for"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {[
            { id: 'base', label: 'All channels' },
            ...pickedChannels.map((c) => ({ id: c.id, label: c.name })),
          ].map((t) => {
            const list = t.id === 'base' ? [] : (issues.get(t.id) ?? []);
            const bad = list.some((i) => i.severity === 'error') || errors?.[`channel:${t.id}`];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls="compose-panel"
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-sm',
                  activeTab === t.id
                    ? 'border-primary font-medium text-text'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {t.label}
                {t.id !== 'base' && overrides[t.id] && <Badge>custom</Badge>}
                {bad && (
                  <span className="size-2 rounded-full bg-danger" aria-label="has problems" />
                )}
              </button>
            );
          })}
        </div>

        <div
          id="compose-panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="flex flex-col gap-3"
        >
          {activeChannel && !thread ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                {activeChannel.name} posts the same text as all channels.
              </p>
              <ThreadPreview
                items={base}
                media={baseMedia}
                library={library}
                provider={activeChannel.provider}
              />
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOverrides((o) => ({ ...o, [activeChannel.id]: [...base] }));
                    setOverrideMedia((o) => ({
                      ...o,
                      [activeChannel.id]: baseMedia.map((list) => list.map((m) => ({ ...m }))),
                    }));
                  }}
                >
                  Customize for {activeChannel.name}
                </Button>
              </div>
            </div>
          ) : (
            <ThreadEditor
              items={thread ?? base}
              onChange={(next) => editThread(activeTab, next)}
              onRemove={(i) => removeItem(activeTab, i, thread ?? base)}
              media={mediaFor(activeTab)}
              onMediaChange={(i, update) => editMedia(activeTab, i, update)}
              workspaceSlug={workspaceSlug}
              library={library}
              canUpload={canUpload}
              providers={
                activeChannel
                  ? [activeChannel.provider]
                  : [
                      ...new Set(
                        pickedChannels.filter((c) => !overrides[c.id]).map((c) => c.provider),
                      ),
                    ]
              }
              idPrefix={activeTab}
            />
          )}
          {activeChannel && thread && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOverrides((o) => {
                    const { [activeChannel.id]: _removed, ...rest } = o;
                    return rest;
                  });
                  setOverrideMedia((o) => {
                    const { [activeChannel.id]: _removed, ...rest } = o;
                    return rest;
                  });
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Use the text for all channels
              </Button>
            </div>
          )}
        </div>
      </section>

      {pickedChannels.length > 0 && (
        <section aria-labelledby="checks-heading" className="flex flex-col gap-2">
          <h2 id="checks-heading" className="font-medium">
            Checks
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {pickedChannels.map((c) => {
              const list = issues.get(c.id) ?? [];
              const serverError = errors?.[`channel:${c.id}`];
              const problems = list.filter((i) => i.severity === 'error');
              return (
                <li key={c.id} className="flex gap-2">
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      problems.length || serverError ? 'bg-danger' : 'bg-success',
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">{c.name}</span>{' '}
                    <span className="text-muted">({providerLabel(c.provider)})</span>:{' '}
                    {serverError ??
                      (problems.length === 0
                        ? 'Ready'
                        : problems
                            .map((i) =>
                              i.itemPosition !== undefined && itemsFor(c.id).length > 1
                                ? `Post ${i.itemPosition + 1}: ${i.message}`
                                : i.message,
                            )
                            .join(' '))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">When</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['schedule', 'now', 'draft'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="mode-choice"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-primary"
              />
              {m === 'schedule' ? 'At a time' : m === 'now' ? 'Now' : 'Draft'}
            </label>
          ))}
        </div>
        {mode !== 'now' && (
          <div className="flex flex-col gap-1.5 sm:w-72">
            <Label htmlFor="scheduled-at">
              {mode === 'draft' ? 'Planned time (optional)' : 'Date and time'}
            </Label>
            <Input
              id="scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required={mode === 'schedule'}
              aria-invalid={errors?.scheduledAt ? true : undefined}
              aria-describedby="scheduled-at-tz"
            />
            <p id="scheduled-at-tz" className="text-sm text-muted">
              Workspace time: {timezone}
            </p>
            <FieldError>{errors?.scheduledAt}</FieldError>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="submit"
          disabled={pending || picked.length === 0 || (mode !== 'draft' && blocking)}
        >
          {pending ? 'Saving…' : MODE_LABEL[mode]}
        </Button>
        {mode !== 'draft' && blocking && (
          <p className="text-sm text-muted">Fix the checks above, or save a draft.</p>
        )}
        <FieldError>
          {state && !state.ok && !errors?.scheduledAt ? state.error : undefined}
        </FieldError>
      </div>
    </form>
  );
}

function Counter({ provider, body }: { provider: ProviderId; body: string }) {
  const { used, max } = charCount(provider, body);
  const over = used > max;
  return (
    <span className={cn('tabular-nums', over ? 'font-medium text-danger' : 'text-muted')}>
      {providerLabel(provider)} {used}/{max}
    </span>
  );
}

function ThreadEditor({
  items,
  onChange,
  onRemove,
  media,
  onMediaChange,
  workspaceSlug,
  library,
  canUpload,
  providers,
  idPrefix,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  onRemove: (i: number) => void;
  media: ItemMedia[][];
  onMediaChange: (i: number, update: MediaUpdate) => void;
  workspaceSlug: string;
  library: ComposerMedia[];
  canUpload: boolean;
  providers: ProviderId[];
  idPrefix: string;
}) {
  const set = (i: number, value: string) => onChange(items.map((b, j) => (j === i ? value : b)));
  return (
    <ol className="flex flex-col gap-3">
      {items.map((body, i) => (
        <li key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-item-${i}`}>
              {i === 0 ? 'Post' : `Thread post ${i + 1}`}
            </Label>
            {i > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(i)}
                aria-label={`Remove thread post ${i + 1}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
          <Textarea
            id={`${idPrefix}-item-${i}`}
            value={body}
            onChange={(e) => set(i, e.target.value)}
            rows={i === 0 ? 5 : 3}
            placeholder={i === 0 ? 'What do you want to share?' : 'Continue the thread'}
          />
          <MediaTray
            workspaceSlug={workspaceSlug}
            idPrefix={`${idPrefix}-item-${i}`}
            attached={media[i] ?? []}
            onChange={(update) => onMediaChange(i, update)}
            library={library}
            canUpload={canUpload}
          />
          {providers.length > 0 && (
            <p className="flex flex-wrap gap-x-3 text-xs" aria-live="polite">
              {providers.map((p) => (
                <Counter key={p} provider={p} body={body} />
              ))}
            </p>
          )}
        </li>
      ))}
      {items.length < MAX_THREAD_ITEMS && (
        <li>
          <Button variant="ghost" size="sm" onClick={() => onChange([...items, ''])}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add to thread
          </Button>
        </li>
      )}
    </ol>
  );
}

function ThreadPreview({
  items,
  media,
  library,
  provider,
}: {
  items: string[];
  media: ItemMedia[][];
  library: ComposerMedia[];
  provider: ProviderId;
}) {
  const byId = new Map(library.map((m) => [m.id, m]));
  return (
    <ol className="flex flex-col gap-2">
      {items.map((body, i) => (
        <li key={i} className="rounded-md border border-border bg-surface p-3 text-sm">
          <p className="whitespace-pre-wrap">{body || <span className="text-muted">Empty</span>}</p>
          {(media[i]?.length ?? 0) > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {media[i]?.map((m) => {
                const url = byId.get(m.mediaId)?.previewUrl;
                return (
                  <li
                    key={m.mediaId}
                    className="size-16 overflow-hidden rounded-sm bg-surface-hover"
                  >
                    {url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={m.altText} className="size-full object-cover" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1 text-xs">
            <Counter provider={provider} body={body} />
          </p>
        </li>
      ))}
    </ol>
  );
}
