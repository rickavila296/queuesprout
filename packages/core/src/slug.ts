import { RESERVED_SLUGS } from '@queuesprout/shared';

/** Turns a workspace name into a URL slug suggestion. The user can still edit it. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (slug === '') return 'workspace';
  return RESERVED_SLUGS.has(slug) ? `${slug}-team` : slug;
}
