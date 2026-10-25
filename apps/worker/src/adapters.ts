import { resolveAdapter, type AdapterResolution } from '@queuesprout/providers';
import { isMockPublish, type ProviderId, type PublishMode } from '@queuesprout/shared';

export interface AdapterSelection {
  provider: ProviderId;
  /** workspaces.is_sandbox of the post's workspace: a sandbox always publishes in mock mode. */
  workspaceIsSandbox: boolean;
}

/**
 * Sandbox mode is decided here, in the worker, from PUBLISH_MODE and the workspace,
 * never from anything the UI sends (ADR-019).
 */
export function createAdapterPicker(env: { PUBLISH_MODE: PublishMode; PUBLIC_URL: string }) {
  return ({ provider, workspaceIsSandbox }: AdapterSelection): AdapterResolution =>
    resolveAdapter(provider, isMockPublish(env.PUBLISH_MODE, workspaceIsSandbox), {
      publicUrl: env.PUBLIC_URL,
    });
}
