'use client';

/**
 * Client component for session list controls.
 * Date range, funnel stage filter, and entity dropdown filters.
 * Fetches campaign/adset/ad lists from /api/entity/filter-options on mount.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface Entity {
  id: string;
  name: string;
  campaign_id?: string;
  adset_id?: string;
}

interface FilterOptions {
  campaigns: Entity[];
  adsets: Entity[];
  ads: Entity[];
}

interface SessionControlsProps {
  dateFrom: string;
  dateTo: string;
  funnelStage: string;
  campaignId: string;
  adsetId: string;
  adId: string;
}

export function SessionControls({
  dateFrom,
  dateTo,
  funnelStage,
  campaignId,
  adsetId,
  adId,
}: SessionControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<FilterOptions>({
    campaigns: [],
    adsets: [],
    ads: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/entity/filter-options')
      .then((res) => (res.ok ? res.json() : { campaigns: [], adsets: [], ads: [] }))
      .then((data: FilterOptions) => setOptions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset page on filter change
      params.delete('page');
      router.push(`/dashboard/sessions?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Filter adsets by selected campaign (if any)
  const filteredAdsets = campaignId
    ? options.adsets.filter((a) => a.campaign_id === campaignId)
    : options.adsets;

  // Filter ads by selected adset (if any), then by campaign
  let filteredAds = options.ads;
  if (adsetId) {
    filteredAds = filteredAds.filter((a) => a.adset_id === adsetId);
  } else if (campaignId) {
    filteredAds = filteredAds.filter((a) => a.campaign_id === campaignId);
  }

  function entityLabel(entity: Entity): string {
    const name = entity.name || '(unnamed)';
    const shortId = entity.id.length > 8 ? entity.id.slice(0, 8) : entity.id;
    return `${name} (${shortId}...)`;
  }

  return (
    <div className="session-controls">
      <div className="control-group">
        <label htmlFor="date-from">From</label>
        <input
          id="date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => updateParam('date_from', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="date-to">To</label>
        <input
          id="date-to"
          type="date"
          value={dateTo}
          onChange={(e) => updateParam('date_to', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="funnel-stage">Funnel stage</label>
        <select
          id="funnel-stage"
          value={funnelStage}
          onChange={(e) => updateParam('funnel_stage', e.target.value)}
        >
          <option value="">All</option>
          <option value="visited">Visited</option>
          <option value="chatted">Chatted</option>
          <option value="revealed">Revealed</option>
          <option value="clicked">Clicked</option>
          <option value="converted">Converted</option>
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="campaign-id">Campaign</label>
        <select
          id="campaign-id"
          value={campaignId}
          onChange={(e) => updateParam('campaign_id', e.target.value)}
          disabled={loading}
        >
          <option value="">All</option>
          {options.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {entityLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="adset-id">Adset</label>
        <select
          id="adset-id"
          value={adsetId}
          onChange={(e) => updateParam('adset_id', e.target.value)}
          disabled={loading}
        >
          <option value="">All</option>
          {filteredAdsets.map((a) => (
            <option key={a.id} value={a.id}>
              {entityLabel(a)}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="ad-id">Ad</label>
        <select
          id="ad-id"
          value={adId}
          onChange={(e) => updateParam('ad_id', e.target.value)}
          disabled={loading}
        >
          <option value="">All</option>
          {filteredAds.map((a) => (
            <option key={a.id} value={a.id}>
              {entityLabel(a)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
