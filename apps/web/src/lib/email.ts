import 'server-only';
import { env } from '@/env';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends through Resend when RESEND_API_KEY is set. In development without a key,
 * prints the message to the server console so sign-in links work offline.
 */
export async function sendEmail(email: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV } = env();
  if (!RESEND_API_KEY) {
    if (NODE_ENV === 'production') throw new Error('Email is not configured.');
    console.info(`\n[dev email] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, ...email }),
  });
  if (!response.ok) {
    // Never include the body we sent: it contains the sign-in link.
    throw new Error(`Resend responded ${response.status}`);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function linkEmail(opts: { heading: string; body: string; cta: string; url: string }) {
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.cta}: ${opts.url}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#121614">
<h1 style="font-size:20px">${escapeHtml(opts.heading)}</h1>
<p>${escapeHtml(opts.body)}</p>
<p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#23804A;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">${escapeHtml(opts.cta)}</a></p>
<p style="color:#5D6661;font-size:12px">If you did not expect this email you can ignore it.</p>
</div>`;
  return { text, html };
}
