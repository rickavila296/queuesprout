import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

// Resolved per request so the build never needs runtime secrets.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
