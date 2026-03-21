/**
 * Tests for GET /api/sessions/[id]
 *
 * Covers:
 *   - Session found
 *   - Session not found (404)
 *   - Duration computation
 *   - Auth guard
 *   - source_payload stripping
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

function makeRequest(id: string): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/sessions/${id}`));
}

describe('GET /api/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ email: 'admin@test.com' });
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAdminUser.mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeRequest('sess_1'), { params: Promise.resolve({ id: 'sess_1' }) });
    expect(res.status).toBe(401);
  });

  it('returns session detail with duration', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'sess_1',
          started_at_utc: '2026-03-15T10:00:00Z',
          ended_at_utc: '2026-03-15T10:05:30Z',
          messages_count: 12,
          source_payload: { raw: 'data' },
        },
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest('sess_1'), { params: Promise.resolve({ id: 'sess_1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.id).toBe('sess_1');
    expect(body.data.duration_ms).toBe(330000); // 5.5 minutes
    // source_payload should be stripped
    expect(body.data.source_payload).toBeUndefined();
  });

  it('returns 404 for non-existent session', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      }),
    };

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest('nonexistent'), { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns null duration when timestamps are missing', async () => {
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'sess_2',
          started_at_utc: '2026-03-15T10:00:00Z',
          ended_at_utc: null,
          source_payload: {},
        },
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue({
      from: () => queryChain,
    });

    const res = await GET(makeRequest('sess_2'), { params: Promise.resolve({ id: 'sess_2' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duration_ms).toBeNull();
  });
});
