export interface Email {
  to: string[];
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export type Mailer = (email: Email) => Promise<void>;

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Sends through Resend (free tier, the same account as sign-in links). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return async (email) => {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Resend drops a repeat within 24 h, covering a crash between send and mark.
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The body names the problem (bad sender, quota); it never echoes the key.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend refused the email (${response.status}): ${detail}`);
    }
  };
}

/** Local development: prints the email instead of sending it. */
export function logMailer(log: { info(obj: object, msg: string): void }): Mailer {
  return async ({ to, subject, text }) => {
    log.info({ to, subject }, `failure email (not sent, no RESEND_API_KEY)\n${text}`);
  };
}
