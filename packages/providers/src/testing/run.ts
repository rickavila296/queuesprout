import type { PublishStep } from '@queuesprout/shared';
import type { ProviderAdapter, PublishContext } from '../contract';

/**
 * Plays the worker's part for one item: calls publish() again with each returned
 * checkpoint until the step is done or an error, and returns every step. Tests only:
 * real adapters must never loop like this (the worker re-enqueues instead).
 */
export async function runUntilSettled<TSettings>(
  adapter: ProviderAdapter<TSettings>,
  ctx: PublishContext<TSettings>,
  maxSteps = 20,
): Promise<PublishStep[]> {
  const steps: PublishStep[] = [];
  let checkpoint = ctx.checkpoint;
  for (let i = 0; i < maxSteps; i++) {
    const step = await adapter.publish({ ...ctx, checkpoint });
    steps.push(step);
    if (step.kind !== 'pending') return steps;
    checkpoint = step.checkpoint;
  }
  throw new Error(`Still pending after ${maxSteps} steps`);
}
