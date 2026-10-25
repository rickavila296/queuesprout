import { ping } from '@queuesprout/db';
import { db } from '@/lib/db';

export async function GET() {
  try {
    await ping(db());
    return Response.json({ ok: true });
  } catch (error) {
    console.error('[health] database unreachable', error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
