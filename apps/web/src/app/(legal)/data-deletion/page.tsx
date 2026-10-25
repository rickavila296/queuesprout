import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = { title: 'Data deletion' };

export default function DataDeletionPage() {
  return (
    <>
      <h1>Data deletion</h1>
      <p>You can remove your data from {site.name} at any time.</p>
      <h2>Disconnect one platform</h2>
      <p>
        Open Channels in your workspace and choose Disconnect. The platform&apos;s tokens are
        deleted immediately. You can also revoke {site.name} from the platform&apos;s own settings
        (for example Facebook Settings, Apps and Websites).
      </p>
      <h2>Delete your account</h2>
      <p>
        Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> from the address you
        sign in with. We delete your account, the workspaces you own, their posts, media and tokens
        within 30 days and confirm by email.
      </p>
    </>
  );
}
