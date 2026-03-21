/**
 * Ghstly Partner API Client
 *
 * Base URL: https://ghstly.chat/api/partner
 * Auth: X-Partner-Key header (from GHSTLY_PARTNER_API_KEY env var)
 *
 * Endpoints:
 *   GET /stats          — ad-level aggregate stats with summary
 *   GET /stats/daily    — ad-level daily-grain stats
 *   GET /sessions       — paginated session list
 *   GET /sessions/:id/messages — session transcript
 */

import type {
  GhstlyStatsResponse,
  GhstlyStatsDailyResponse,
  GhstlySessionsResponse,
} from '@/lib/contracts/data-contract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhstlyStatsFilters {
  campaign_id?: string;
  adset_id?: string;
}

export interface GhstlyStatsDailyFilters {
  date_from?: string;
  date_to?: string;
  campaign_id?: string;
  adset_id?: string;
}

export interface GhstlySessionsParams {
  limit?: number;
  offset?: number;
  campaign_id?: string;
  adset_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface GhstlySessionMessage {
  id: string;
  session_id: string;
  sender: 'user' | 'bot';
  content: string;
  created_at: string;
}

export interface GhstlySessionMessagesResponse {
  items: GhstlySessionMessage[];
}

export interface GhstlyClientConfig {
  baseUrl: string;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GhstlyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: GhstlyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  /**
   * Create a client from environment variables.
   */
  static fromEnv(): GhstlyClient {
    const apiKey = process.env.GHSTLY_PARTNER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Missing required environment variable: GHSTLY_PARTNER_API_KEY');
    }
    return new GhstlyClient({
      baseUrl: 'https://ghstly.chat/api/partner',
      apiKey,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Partner-Key': this.apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GhstlyApiError(
        `Ghstly API error: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * GET /stats — ad-level aggregate stats with summary totals.
   * Supports optional campaign_id and adset_id filters.
   * Filtered calls return exact campaign/adset range totals in `summary`.
   */
  async fetchStats(filters?: GhstlyStatsFilters): Promise<GhstlyStatsResponse> {
    return this.request<GhstlyStatsResponse>('/stats', {
      campaign_id: filters?.campaign_id,
      adset_id: filters?.adset_id,
    });
  }

  /**
   * GET /stats/daily — ad-level daily-grain stats.
   * Supports optional date_from, date_to, campaign_id, adset_id filters.
   * NOTE: group_by and level params are ignored by the API per live verification.
   */
  async fetchStatsDaily(filters?: GhstlyStatsDailyFilters): Promise<GhstlyStatsDailyResponse> {
    return this.request<GhstlyStatsDailyResponse>('/stats/daily', {
      date_from: filters?.date_from,
      date_to: filters?.date_to,
      campaign_id: filters?.campaign_id,
      adset_id: filters?.adset_id,
    });
  }

  /**
   * GET /sessions — paginated session list.
   * Default limit is 100, max offset for pagination.
   */
  async fetchSessions(params?: GhstlySessionsParams): Promise<GhstlySessionsResponse> {
    return this.request<GhstlySessionsResponse>('/sessions', {
      limit: params?.limit,
      offset: params?.offset,
      campaign_id: params?.campaign_id,
      adset_id: params?.adset_id,
      date_from: params?.date_from,
      date_to: params?.date_to,
    });
  }

  /**
   * GET /sessions/:id/messages — session transcript.
   */
  async fetchSessionMessages(sessionId: string): Promise<GhstlySessionMessagesResponse> {
    return this.request<GhstlySessionMessagesResponse>(`/sessions/${sessionId}/messages`);
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class GhstlyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = 'GhstlyApiError';
  }

  /** 429 or 5xx errors are retryable */
  get isRetryable(): boolean {
    return this.statusCode === 429 || this.statusCode >= 500;
  }
}
