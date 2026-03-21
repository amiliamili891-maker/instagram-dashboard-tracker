/**
 * Tests for GET /api/sessions
 *
 * Covers:
 *   - Pagination (page, limit)
 *   - Funnel stage filtering
 *   - Date validation
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
  const url = new URL('http://localhost/api/sessions');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ email: 'admin@test.com' });
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAdminUser.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid date_from', async () => {
    const res = await GET(makeRequest({ date_from: 'not-a-date' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid funnel_stage', async () => {
    const res = await GET(makeRequest({ funnel_stage: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('returns paginated sessions', async () => {
    const mockSessions = [
      { id: 'sess_1', created_at_utc: '2026-03-15T10:00:00Z', messages_count: 5 },
      { id: 'sess_2', created_at_utc: '2026-03-15T09:00:00Z', messages_count: 0 },
    ];

    const queryChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };

    queryChain.range.mockResolvedValue({
      data: mockSessions,
      error: null,
      count: 50,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({ page: '1', limit: '25' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(25);
    expect(body.meta.total).toBe(50);
    expect(body.meta.total_pages).toBe(2);
  });

  it('clamps limit to 100', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };

    queryChain.range.mockResolvedValue({
      data: [],
      error: null,
      count: 0,
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({ limit: '500' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.limit).toBe(100);
  });

  it('applies funnel stage filter for "chatted"', async () => {
    const resolvedValue = {
      data: [],
      error: null,
      count: 0,
    };

    // Build a chainable mock where every method returns the chain itself,
    // and the chain is also thenable (so `await query` works).
    const queryChain: Record<string, ReturnType<typeof vi.fn>> = {};
    const methods = ['select', 'order', 'range', 'eq', 'gt', 'gte', 'lte'];
    for (const m of methods) {
      queryChain[m] = vi.fn().mockReturnValue(queryChain);
    }
    // Make the chain thenable
    queryChain.then = vi.fn((resolve: (v: typeof resolvedValue) => void) => {
      resolve(resolvedValue);
      return queryChain;
    });

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest({ funnel_stage: 'chatted' }));
    expect(res.status).toBe(200);
    // Verify gt was called (for messages_count > 0)
    expect(queryChain.gt).toHaveBeenCalledWith('messages_count', 0);
  });
});
