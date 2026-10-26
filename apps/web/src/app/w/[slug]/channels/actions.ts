'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertRole, ForbiddenError } from '@queuesprout/auth';
import {
  encryptAppSecret,
  encryptCredentials,
  encryptOAuthSecret,
  hashOAuthState,
  newOAuthState,
} from '@queuesprout/core/credentials';
import {
  connectAccount,
  createOAuthSession,
  findProviderApp,
  getWorkspace,
  removeChannel,
  saveProviderApp,
  upsertChannel,
} from '@queuesprout/db';
import { demoAccount } from '@queuesprout/providers/client';
import {
  BLUESKY_APP_PASSWORD_PATTERN,
  ConnectError,
  normalizeMastodonInstance,
  oauthConnector,
  secretConnector,
  type ConnectedAccountInput,
} from '@queuesprout/providers/connect';
import { fail, ok, providerIdSchema, workspaceSlugSchema } from '@queuesprout/shared';
import { invalid, unexpected, type FormState } from '@/lib/actions';
import { oauthRedirectUri, saveConnectedAccount } from '@/lib/connect';
import { dataAccess } from '@/lib/db';
import { keyring } from '@/lib/keyring';
import { providerLabel } from '@/lib/providers';
import { workspaceIsMock } from '@/lib/publish-mode';
import { requireWorkspace } from '@/lib/session';
import { env } from '@/env';
import { site } from '@/lib/site';

const demoSchema = z.object({ workspaceSlug: workspaceSlugSchema, provider: providerIdSchema });

/**
 * Adds a fake account and channel for one provider, with no OAuth. Only offered when the
 * workspace publishes in mock mode, and the worker re-checks that before every step.
 */
export async function connectDemoChannelAction(
  _prev: FormState<{ name: string }>,
  formData: FormData,
): Promise<FormState<{ name: string }>> {
  const parsed = demoSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    provider: formData.get('provider'),
  });
  if (!parsed.success) return fail('Pick a provider.');
  const { workspaceSlug, provider } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'admin');
    const keys = keyring();
    if (!keys) return fail('Set TOKEN_ENCRYPTION_KEY in .env, then restart the app.');

    const name = await dataAccess().withWorkspace(ctx, async (tx) => {
      const workspace = await getWorkspace(tx, ctx.workspaceId);
      if (!workspace || !workspaceIsMock(workspace)) return null;

      const account = demoAccount(provider);
      const encrypted = encryptCredentials(
        keys,
        { workspaceId: ctx.workspaceId, provider, externalAccountId: account.externalAccountId },
        account.creds,
      );
      const connected = await connectAccount(tx, {
        workspaceId: ctx.workspaceId,
        provider,
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        ...encrypted,
      });
      if (!connected.ok) throw new ForbiddenError('admin');
      for (const target of account.targets) {
        await upsertChannel(tx, {
          workspaceId: ctx.workspaceId,
          accountId: connected.accountId,
          provider,
          targetType: target.targetType,
          externalTargetId: target.externalTargetId,
          name: target.name,
          handle: target.handle ?? null,
          avatarUrl: target.avatarUrl ?? null,
          defaultSettings: target.defaultSettings ?? {},
        });
      }
      return account.displayName;
    });
    if (!name) return fail('Demo channels are only available in sandbox mode.');

    revalidatePath(`/w/${workspaceSlug}/channels`);
    return ok({ name: `${name} (${providerLabel(provider)})` });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    return unexpected('connectDemoChannel', error);
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

const blueskySchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  handle: z
    .string()
    .trim()
    .min(1, 'Enter your handle.')
    .max(253)
    .regex(/^@?[a-zA-Z0-9.-]+$/, 'Handles look like alice.bsky.social.'),
  appPassword: z
    .string()
    .trim()
    .regex(BLUESKY_APP_PASSWORD_PATTERN, 'App passwords look like abcd-efgh-ijkl-mnop.'),
  serviceUrl: z
    .union([z.literal(''), z.url({ protocol: /^https$/, error: 'Use an https:// address.' })])
    .optional()
    .transform((v) => v || undefined),
});

/**
 * Connects a Bluesky account with a handle and an app password. The password is sent to
 * Bluesky once to start a session and is never stored; only the session tokens are,
 * encrypted. Admins only.
 */
export async function connectBlueskyAction(
  _prev: FormState<{ name: string }>,
  formData: FormData,
): Promise<FormState<{ name: string }>> {
  const parsed = blueskySchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    handle: formData.get('handle'),
    appPassword: formData.get('appPassword'),
    serviceUrl: formData.get('serviceUrl') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);
  const { workspaceSlug, handle, appPassword, serviceUrl } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  try {
    assertRole(ctx, 'admin');
    const keys = keyring();
    if (!keys) return fail('Set TOKEN_ENCRYPTION_KEY in .env, then restart the app.');
    const workspace = await dataAccess().withWorkspace(ctx, (tx) =>
      getWorkspace(tx, ctx.workspaceId),
    );
    if (!workspace || workspace.isSandbox) {
      return fail('Sandbox workspaces use demo channels only.');
    }
    const connect = secretConnector('bluesky');
    if (!connect) return fail('Bluesky is not available.');

    // The network call happens before the transaction, so no lock waits on Bluesky.
    let account: ConnectedAccountInput;
    try {
      account = await connect({
        identifier: handle,
        secret: appPassword,
        instanceUrl: serviceUrl,
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof ConnectError) return fail(error.message);
      throw error;
    }

    await saveConnectedAccount(ctx, keys, 'bluesky', account);

    revalidatePath(`/w/${workspaceSlug}`, 'layout');
    return ok({ name: account.displayName });
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    // Never pass the form data along: it holds the app password.
    return unexpected('connectBluesky', error);
  }
}

const mastodonSchema = z.object({
  workspaceSlug: workspaceSlugSchema,
  instance: z
    .string()
    .trim()
    .min(1, 'Enter your server, like mastodon.social.')
    .max(253)
    .transform((value, issue) => {
      const origin = normalizeMastodonInstance(value);
      if (!origin) {
        issue.addIssue({
          code: 'custom',
          message: 'Enter a public server address like mastodon.social.',
        });
        return z.NEVER;
      }
      return origin;
    }),
});

/**
 * Starts connecting a Mastodon account: registers QueueSprout on the instance the first
 * time anyone uses it, records a single-use sign-in session, and sends the admin to the
 * instance's consent screen. The callback route finishes the job.
 */
export async function startMastodonConnectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = mastodonSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    instance: formData.get('instance'),
  });
  if (!parsed.success) return invalid(parsed.error);
  const { workspaceSlug, instance } = parsed.data;

  const { ctx } = await requireWorkspace(workspaceSlug);
  let authUrl: string;
  try {
    assertRole(ctx, 'admin');
    const keys = keyring();
    if (!keys) return fail('Set TOKEN_ENCRYPTION_KEY in .env, then restart the app.');
    const connector = oauthConnector('mastodon');
    if (!connector?.registerApp) return fail('Mastodon is not available.');
    const workspace = await dataAccess().withWorkspace(ctx, (tx) =>
      getWorkspace(tx, ctx.workspaceId),
    );
    if (!workspace || workspace.isSandbox) {
      return fail('Sandbox workspaces use demo channels only.');
    }

    const appKey = { provider: 'mastodon', instanceUrl: instance };
    const redirectUri = oauthRedirectUri('mastodon');
    let app = await dataAccess().withWorkspace(ctx, (tx) =>
      findProviderApp(tx, {
        workspaceId: ctx.workspaceId,
        provider: 'mastodon',
        instanceUrl: instance,
      }),
    );
    if (!app) {
      // First account on this instance: register QueueSprout there (outside any transaction).
      const registered = await connector.registerApp({
        instanceUrl: instance,
        redirectUri,
        clientName: site.name,
        website: env().PUBLIC_URL,
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
      app = await dataAccess().withWorkspace(ctx, (tx) =>
        saveProviderApp(tx, {
          workspaceId: ctx.workspaceId,
          provider: 'mastodon',
          instanceUrl: instance,
          clientId: registered.clientId,
          clientSecretEnc: encryptAppSecret(keys, appKey, registered.clientSecret),
          keyVersion: keys.currentVersion,
        }),
      );
    }

    const state = newOAuthState();
    const stateHash = hashOAuthState(state);
    const start = await connector.getAuthUrl({
      state,
      redirectUri,
      clientId: app.clientId,
      instanceUrl: instance,
    });
    const providerAppId = app.id;
    await dataAccess().withWorkspace(ctx, (tx) =>
      createOAuthSession(tx, {
        stateHash,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        provider: 'mastodon',
        providerAppId,
        codeVerifierEnc: start.codeVerifier
          ? encryptOAuthSecret(keys, stateHash, 'code_verifier', start.codeVerifier)
          : null,
        keyVersion: keys.currentVersion,
        redirectTo: `/w/${workspaceSlug}/channels`,
      }),
    );
    authUrl = start.url;
  } catch (error) {
    if (error instanceof ForbiddenError) return fail(error.message);
    if (error instanceof ConnectError) return fail(error.message);
    return unexpected('startMastodonConnect', error);
  }
  // Outside the try: redirect() works by throwing.
  redirect(authUrl as Route);
}

const removeSchema = z.object({ workspaceSlug: workspaceSlugSchema, channelId: z.uuid() });

export async function removeChannelAction(formData: FormData): Promise<void> {
  const parsed = removeSchema.safeParse({
    workspaceSlug: formData.get('workspaceSlug'),
    channelId: formData.get('channelId'),
  });
  if (!parsed.success) return;
  const { ctx } = await requireWorkspace(parsed.data.workspaceSlug);
  assertRole(ctx, 'admin');
  await dataAccess().withWorkspace(ctx, (tx) =>
    removeChannel(tx, ctx.workspaceId, parsed.data.channelId),
  );
  revalidatePath(`/w/${parsed.data.workspaceSlug}`, 'layout');
}
