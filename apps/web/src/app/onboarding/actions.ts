'use server';

import { redirect } from 'next/navigation';
import { createWorkspace } from '@queuesprout/db';
import { createWorkspaceSchema, fail } from '@queuesprout/shared';
import { invalid, unexpected, type FormState } from '@/lib/actions';
import { dataAccess } from '@/lib/db';
import { requireUser } from '@/lib/session';

export async function createWorkspaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser('/onboarding');
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    timezone: formData.get('timezone') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  let slug: string;
  try {
    const result = await dataAccess().withUser(user.id, (tx) => createWorkspace(tx, parsed.data));
    if (!result.ok) {
      return {
        ...fail('That URL is taken.'),
        fieldErrors: { slug: 'That URL is taken. Try another.' },
      };
    }
    slug = parsed.data.slug;
  } catch (error) {
    return unexpected('createWorkspace', error);
  }
  redirect(`/w/${slug}`);
}
