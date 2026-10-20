import { NextResponse } from 'next/server';

import { verifyUnsubscribeToken } from '@/lib/outreach/compliance';
import { suppress } from '@/lib/outreach/process';

function valid(email: string | null, token: string | null): email is string {
  if (!email || !token) return false;
  try {
    return verifyUnsubscribeToken(email, token);
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function page(message: string, status = 200) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Opt out</title><body style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:0 16px">${message}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/**
 * Opt-out landing page. It only shows a confirm button: mail scanners and link
 * previewers fetch GET links automatically and must not trigger the opt-out.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const email = params.get('email');
  const token = params.get('token');
  if (!valid(email, token)) return page('<p>This opt-out link is invalid.</p>', 400);
  const action = `?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token ?? '')}`;
  return page(
    `<p>Stop emails to <strong>${escapeHtml(email)}</strong>?</p><form method="post" action="${escapeHtml(action)}"><button type="submit" style="padding:10px 18px;font-size:16px">Yes, opt me out</button></form>`,
  );
}

/** Confirms the opt-out. Also serves RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const email = params.get('email');
  if (!valid(email, params.get('token'))) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }
  await suppress(email, 'unsubscribed');
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  return wantsHtml
    ? page('<p>You have been removed. We will not email you again.</p>')
    : NextResponse.json({ success: true });
}
