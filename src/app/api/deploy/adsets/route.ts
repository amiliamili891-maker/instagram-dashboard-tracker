/**
 * GET /api/deploy/adsets
 *
 * List available Meta ad sets for the deploy UI dropdown.
 * Optional ?campaign_id= filter to scope to a specific campaign.
 */

import { requireAdminUser } from '@/lib/auth/guards';
import { listAdSets } from '@/lib/api/meta-deploy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // 1. Auth
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Optional campaign_id filter
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id') ?? undefined;

  if (campaignId && !/^\d+$/.test(campaignId)) {
    return Response.json(
      { error: 'campaign_id must be a numeric string' },
      { status: 400 },
    );
  }

  // 3. Fetch ad sets from Meta
  try {
    const adsets = await listAdSets(campaignId);

    return Response.json(
      { adsets },
      {
        headers: {
          'Cache-Control': 'private, s-maxage=300',
        },
      },
    );
  } catch (err: unknown) {
    console.error('Failed to list ad sets:', err);
    return Response.json(
      { error: 'Failed to list ad sets. Please try again.' },
      { status: 502 },
    );
  }
}
