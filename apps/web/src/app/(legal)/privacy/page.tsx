import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>
        {site.name} is an open-source tool for scheduling posts to social networks. This policy
        covers the hosted service. Self-hosted instances are run by their operators.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Your account: email address, name and avatar from the sign-in method you choose.</li>
        <li>Workspace content: posts, media and schedules you create.</li>
        <li>
          Connected social accounts: the access tokens each platform issues when you connect it,
          your account or page identifiers and display names.
        </li>
        <li>Operational logs: request and publishing logs, kept for up to 30 days.</li>
      </ul>
      <h2>How we use it</h2>
      <p>
        Only to run the service: to sign you in, to publish the posts you schedule to the channels
        you connect, and to show you their status. We do not sell data, show ads, or use your
        content to train models.
      </p>
      <h2>How we protect it</h2>
      <p>
        Platform tokens are encrypted at rest with AES-256-GCM and are readable only by the
        publishing worker. Workspace data is isolated per tenant with row-level security.
      </p>
      <h2>Sharing</h2>
      <p>
        Your posts are sent to the platforms you choose. We use infrastructure providers (hosting,
        database, storage and email) that process data on our behalf.
      </p>
      <h2>Your choices</h2>
      <p>
        You can disconnect a channel at any time, which deletes its tokens. To delete your account
        and all its data, follow the steps on the <a href="/data-deletion">data deletion page</a>.
      </p>
      <h2>Contact</h2>
      <p>
        Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </>
  );
}
