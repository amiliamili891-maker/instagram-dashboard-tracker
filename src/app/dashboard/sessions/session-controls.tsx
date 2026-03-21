'use client';

/**
 * Client component for session list controls.
 * Date range, funnel stage filter, and entity ID filters.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

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
        <label htmlFor="campaign-id">Campaign ID</label>
        <input
          id="campaign-id"
          type="text"
          placeholder="Filter..."
          value={campaignId}
          onChange={(e) => updateParam('campaign_id', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="adset-id">Adset ID</label>
        <input
          id="adset-id"
          type="text"
          placeholder="Filter..."
          value={adsetId}
          onChange={(e) => updateParam('adset_id', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="ad-id">Ad ID</label>
        <input
          id="ad-id"
          type="text"
          placeholder="Filter..."
          value={adId}
          onChange={(e) => updateParam('ad_id', e.target.value)}
        />
      </div>
    </div>
  );
}
