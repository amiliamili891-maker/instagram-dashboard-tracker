/**
 * Tests for GET /api/stats/geo
 *
 * Covers:
 *   - Parameter validation (missing/invalid group_by, dates)
 *   - Geo aggregation logic
 *   - Auth guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdminUser = vi.fn();
const mockCreateClient = vi.fn();

vi.mock('@/lib/auth/guards', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
}));

vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-key',
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockCreateClient(),
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/stats/geo');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe('GET /api/stats/geo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ email: 'admin@test.com' });
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAdminUser.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeRequest({
      group_by: 'country',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing group_by', async () => {
    const res = await GET(makeRequest({
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid group_by', async () => {
    const res = await GET(makeRequest({
      group_by: 'zip_code',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing dates', async () => {
    const res = await GET(makeRequest({ group_by: 'country' }));
    expect(res.status).toBe(400);
  });

  it('aggregates sessions by country', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    queryChain.lte.mockResolvedValue({
      data: [
        { country: 'US', reached_reveal: true, clicked_through: true, converted: false, messages_count: 5 },
        { country: 'US', reached_reveal: false, clicked_through: false, converted: false, messages_count: 3 },
        { country: 'UK', reached_reveal: true, clicked_through: false, converted: true, messages_count: 8 },
        { country: 'UK', reached_reveal: false, clicked_through: false, converted: false, messages_count: 0 },
      ],
      error: null,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({
      group_by: 'country',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    // US has 2 sessions, both chatted, 1 revealed
    const us = body.data.find((r: { location: string }) => r.location === 'US');
    expect(us.sessions).toBe(2);
    expect(us.chatted).toBe(2);
    expect(us.chat_rate).toBe(1.0);
    expect(us.revealed).toBe(1);
    expect(us.reveal_rate).toBe(0.5);

    // UK has 2 sessions, 1 chatted, 1 revealed
    const uk = body.data.find((r: { location: string }) => r.location === 'UK');
    expect(uk.sessions).toBe(2);
    expect(uk.chatted).toBe(1);
    expect(uk.revealed).toBe(1);
    expect(uk.converted).toBe(1);

    expect(body.meta.total_sessions).toBe(4);
    expect(body.meta.unique_locations).toBe(2);
  });

  it('handles empty results', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    queryChain.lte.mockResolvedValue({
      data: [],
      error: null,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({
      group_by: 'city',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.meta.total_sessions).toBe(0);
  });
});
