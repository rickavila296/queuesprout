import { z } from 'zod';

/**
 * ADR-019: mock is the default everywhere except production. The worker enforces it;
 * a post runs in mock mode if PUBLISH_MODE is mock or its workspace is a sandbox.
 */
export const publishModeSchema = z.enum(['live', 'mock']).default('mock');
export type PublishMode = z.infer<typeof publishModeSchema>;

export function isMockPublish(mode: PublishMode, workspaceIsSandbox: boolean): boolean {
  return mode === 'mock' || workspaceIsSandbox;
}
