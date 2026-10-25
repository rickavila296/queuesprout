import 'server-only';
import { isMockPublish } from '@queuesprout/shared';
import { env } from '@/env';

/**
 * Whether this workspace publishes to mock channels. The worker decides for real when
 * it picks the adapter; the web app only uses this to offer demo channels.
 */
export function workspaceIsMock(workspace: { isSandbox: boolean }): boolean {
  return isMockPublish(env().PUBLISH_MODE, workspace.isSandbox);
}
