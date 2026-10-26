import { describe, expect, it } from 'vitest';
import { renderFailureEmail } from './failure-email';

const base = {
  workspaceName: 'Acme Coffee',
  postUrl: 'https://queuesprout.com/w/acme/posts/123',
  excerpt: 'Fresh roast drops Friday',
};

describe('renderFailureEmail', () => {
  it('names the channel when one failed', () => {
    const email = renderFailureEmail({
      ...base,
      failures: [
        {
          channel: '#social',
          providerLabel: 'Slack',
          errorKind: 'auth',
          errorMessage: 'The Slack app was removed.',
        },
      ],
    });
    expect(email.subject).toBe('Post failed on #social (Slack)');
    expect(email.text).toContain('"Fresh roast drops Friday"');
    expect(email.text).toContain(
      '- #social (Slack): The Slack app was removed. Reconnect the account',
    );
    expect(email.text).toContain('https://queuesprout.com/w/acme/posts/123');
  });

  it('counts channels when several failed, and warns about unknown results', () => {
    const email = renderFailureEmail({
      ...base,
      failures: [
        { channel: '@acme', providerLabel: 'Mastodon', errorKind: 'transient', errorMessage: null },
        {
          channel: '#general',
          providerLabel: 'Discord',
          errorKind: 'unknown',
          errorMessage: 'Discord timed out.',
        },
      ],
    });
    expect(email.subject).toBe('Post failed on 2 channels');
    expect(email.text).toContain('@acme (Mastodon): Failed. Retry it from the post page.');
    expect(email.text).toContain('Check the platform before retrying.');
  });

  it('escapes what users wrote in the HTML and shortens long posts', () => {
    const email = renderFailureEmail({
      ...base,
      workspaceName: '<b>Acme</b>',
      excerpt: `<script>alert(1)</script> ${'word '.repeat(60)}`,
      failures: [
        { channel: '"#x"', providerLabel: 'Slack', errorKind: 'validation', errorMessage: '<i>' },
      ],
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Acme</b>');
    expect(email.html).toContain('&#60;b&#62;Acme&#60;/b&#62;');
    expect(email.text).toMatch(/…"/);
  });

  it('does not repeat advice the error already gives', () => {
    const email = renderFailureEmail({
      ...base,
      failures: [
        {
          channel: 'QueueSprout',
          providerLabel: 'Telegram',
          errorKind: 'unknown',
          errorMessage:
            'The connection to Telegram dropped, so the message may or may not be posted. Check the platform before retrying.',
        },
      ],
    });
    expect(email.text.match(/Check the platform before retrying/g)).toHaveLength(1);
  });
});
