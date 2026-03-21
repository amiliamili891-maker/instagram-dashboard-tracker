/**
 * Tests for GET /api/stats/trends
 *
 * Covers:
 *   - Parameter validation (missing/invalid metric, dates)
 *   - Cross-source metric suppression in degraded/stale states
 *   - Rate metric aggregation (average vs sum)
 *   - Comparison mode
 *   - Auth guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the route
const mockRequireAdminUser = vi.fn();
const mockFrom = vi.fn();
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
  const url = new URL('http://localhost/api/stats/trends');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe('GET /api/stats/trends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ email: 'admin@test.com' });
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAdminUser.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeRequest({ metric: 'spend', date_from: '2026-03-01', date_to: '2026-03-07' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing metric', async () => {
    const res = await GET(makeRequest({ date_from: '2026-03-01', date_to: '2026-03-07' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('metric');
  });

  it('returns 400 for invalid metric', async () => {
    const res = await GET(makeRequest({ metric: 'not_a_metric', date_from: '2026-03-01', date_to: '2026-03-07' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing date params', async () => {
    const res = await GET(makeRequest({ metric: 'spend' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('date_from');
  });

  it('returns 400 for invalid date format', async () => {
    const res = await GET(makeRequest({ metric: 'spend', date_from: '03/01/2026', date_to: '2026-03-07' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('date format');
  });

  it('returns 400 for invalid compare_from format', async () => {
    const res = await GET(makeRequest({
      metric: 'spend',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
      compare_from: 'bad',
    }));
    expect(res.status).toBe(400);
  });

  it('returns trend data for valid params', async () => {
    const mockSelect = vi.fn().mockReturnThis();
    const mockGte = vi.fn().mockReturnThis();
    const mockLte = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();

    // Simulate query chain that resolves
    const queryChain = {
      select: mockSelect,
      gte: mockGte,
      lte: mockLte,
      order: mockOrder,
      eq: mockEq,
    };

    // Make the last call in the chain resolve data
    mockOrder.mockResolvedValue({
      data: [
        { report_date: '2026-03-01', spend: 50.00, freshness_state: 'fresh' },
        { report_date: '2026-03-01', spend: 30.00, freshness_state: 'fresh' },
        { report_date: '2026-03-02', spend: 100.00, freshness_state: 'fresh' },
      ],
      error: null,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({
      metric: 'spend',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    // Spend is additive, so 50 + 30 = 80 for 2026-03-01
    expect(body.data[0]).toEqual({ date: '2026-03-01', value: 80 });
    expect(body.data[1]).toEqual({ date: '2026-03-02', value: 100 });
    expect(body.meta.metric).toBe('spend');
    expect(body.meta.is_cross_source).toBe(false);
  });

  it('suppresses cross-source metrics in degraded state', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    queryChain.order.mockResolvedValue({
      data: [
        { report_date: '2026-03-01', cost_per_chat: 2.50, freshness_state: 'degraded' },
      ],
      error: null,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({
      metric: 'cost_per_chat',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].value).toBeNull();
    expect(body.meta.is_cross_source).toBe(true);
  });

  it('averages rate metrics instead of summing', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    queryChain.order.mockResolvedValue({
      data: [
        { report_date: '2026-03-01', ctr: 0.02, freshness_state: 'fresh' },
        { report_date: '2026-03-01', ctr: 0.04, freshness_state: 'fresh' },
      ],
      error: null,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({
      metric: 'ctr',
      date_from: '2026-03-01',
      date_to: '2026-03-07',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // Average of 0.02 and 0.04 = 0.03
    expect(body.data[0].value).toBeCloseTo(0.03);
  });
});
