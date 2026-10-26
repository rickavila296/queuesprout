import type { NextRequest } from 'next/server';
import {
  decryptAppSecret,
  decryptOAuthSecret,
  hashOAuthState,
} from '@queuesprout/core/credentials';
import {
  consumeOAuthSession,
  getWorkspace,
  providerAppForSession,
  type WorkspaceContext,
} from '@queuesprout/db';
import { ConnectError, oauthConnector } from '@queuesprout/providers/connect';
import { providerIdSchema } from '@queuesprout/shared';
import { oauthRedirectUri, saveConnectedAccount, type ConnectResult } from '@/lib/connect';
import { dataAccess } from '@/lib/db';
import { keyring } from '@/lib/keyring';
import { getSession } from '@/lib/session';

const CONNECT_TIMEOUT_MS = 15_000;

/** Back to the page the flow started from, with a result code the page turns into text. */
function back(request: NextRequest, path: string, result: ConnectResult) {
  const url = new URL(path, request.nextUrl.origin);
  url.searchParams.set('connect', result);
  return Response.redirect(url, 303);
}

/**
 * Where a provider's consent screen returns. The state is single use, bound to the user
 * who started the flow and valid for 10 minutes; the code is exchanged here, and the
 * account's tokens are encrypted before they are stored.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/oauth/[provider]/callback'>,
) {
  const provider = providerIdSchema.safeParse((await ctx.params).provider);
  const connector = provider.success ? oauthConnector(provider.data) : null;
  if (!provider.success || !connector) return new Response('Not found', { status: 404 });

  const session = await getSession();
  if (!session) return Response.redirect(new URL('/sign-in', request.nextUrl.origin), 303);
  const userId = session.user.id;

  const params = request.nextUrl.searchParams;
  const state = params.get('state');
  if (!state) return back(request, '/app', 'expired');
  const stateHash = hashOAuthState(state);

  // Single use: a replayed or forged state finds nothing.
  const flow = await dataAccess().withUser(userId, (tx) => consumeOAuthSession(tx, stateHash));
  if (!flow || flow.provider !== provider.data) return back(request, '/app', 'expired');

  const workspace = await dataAccess().withUser(userId, (tx) => getWorkspace(tx, flow.workspaceId));
  const wctx: WorkspaceContext | null = workspace
    ? await dataAccess().resolveWorkspace(userId, workspace.slug)
    : null;
  if (!wctx) return back(request, '/app', 'expired');
  const done = (result: ConnectResult) => back(request, flow.redirectTo, result);

  // The user declined on the provider's consent screen.
  if (params.get('error')) return done('cancelled');
  const code = params.get('code');
  if (!code) return done('expired');

  const keys = keyring();
  if (!keys) return done('failed');
  try {
    const app = await dataAccess().withWorkspace(wctx, (tx) => providerAppForSession(tx, flow.id));
    if (!app) return done('expired');
    const account = await connector.exchangeCode({
      code,
      redirectUri: oauthRedirectUri(provider.data),
      clientId: app.clientId,
      clientSecret: decryptAppSecret(
        keys,
        { provider: provider.data, instanceUrl: app.instanceUrl },
        app.clientSecretEnc,
      ),
      ...(flow.codeVerifierEnc && {
        codeVerifier: decryptOAuthSecret(keys, stateHash, 'code_verifier', flow.codeVerifierEnc),
      }),
      instanceUrl: app.instanceUrl,
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    await saveConnectedAccount(wctx, keys, provider.data, account, app.id);
  } catch (error) {
    if (error instanceof ConnectError) {
      return done(error.code === 'invalid_credentials' ? 'rejected' : error.code);
    }
    // Never log the request: its query string holds the authorization code.
    console.error('[oauth callback]', provider.data, (error as Error).name);
    return done('failed');
  }
  return done('connected');
}
