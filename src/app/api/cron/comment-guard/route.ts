/**
 * GET /api/cron/comment-guard — Vercel Cron (hourly at :07)
 *
 * Triggers the Meta Comment Guard GitHub Actions workflow via workflow_dispatch.
 * Vercel cron is reliable; GitHub Actions schedule is not.
 */

import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const GITHUB_REPO = 'amiliamili891-maker/meta-comment-guard';
const WORKFLOW_FILE = 'comment-guard.yml';

export async function GET(request: Request) {
  // Authenticate: Vercel sends CRON_SECRET as Bearer token
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not configured');
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const githubPat = process.env.GITHUB_PAT;
  if (!githubPat) {
    console.error('GITHUB_PAT not configured');
    return Response.json({ error: 'GITHUB_PAT missing' }, { status: 500 });
  }

  // Trigger the workflow
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    );

    if (response.status === 204) {
      console.log('[comment-guard] Workflow dispatched successfully');
      return Response.json({ ok: true, dispatched: true });
    }

    const body = await response.text();
    console.error(`[comment-guard] GitHub API error: ${response.status} ${body}`);
    return Response.json(
      { error: 'GitHub dispatch failed', status: response.status, body },
      { status: 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[comment-guard] Dispatch error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
