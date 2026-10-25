/** Object key layout. Every key starts with the workspace id so a tenant can be purged by prefix. */
export function originalKey(workspaceId: string, mediaId: string, ext: string): string {
  return `ws/${workspaceId}/${mediaId}/original.${normaliseExt(ext)}`;
}

export function variantKey(
  workspaceId: string,
  mediaId: string,
  variant: string,
  ext: string,
): string {
  return `ws/${workspaceId}/${mediaId}/${variant}.${normaliseExt(ext)}`;
}

export function workspacePrefix(workspaceId: string): string {
  return `ws/${workspaceId}/`;
}

function normaliseExt(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(clean)) throw new Error(`Invalid file extension: ${ext}`);
  return clean;
}
