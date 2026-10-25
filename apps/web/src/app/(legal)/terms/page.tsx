import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = { title: 'Terms of service' };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p>
        By using the hosted {site.name} service you agree to these terms. The source code is
        licensed separately under the GNU Affero General Public License v3.0.
      </p>
      <h2>Your content and accounts</h2>
      <p>
        You own what you post. You are responsible for following the rules of every platform you
        connect, and you give {site.name} permission to publish to those platforms on your behalf at
        the times you schedule.
      </p>
      <h2>Acceptable use</h2>
      <ul>
        <li>No spam, platform manipulation, or content that breaks the law.</li>
        <li>No attempts to access other workspaces or to disrupt the service.</li>
      </ul>
      <h2>The service</h2>
      <p>
        {site.name} is a portfolio project provided as is, without warranties. Platforms can change
        or revoke API access at any time, so a scheduled post may fail; we show every failure in the
        app. We may suspend accounts that break these terms.
      </p>
      <h2>Contact</h2>
      <p>
        Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </>
  );
}
