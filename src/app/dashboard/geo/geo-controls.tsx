'use client';

/**
 * Client component for geo page controls.
 * Group-by selector and date range.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface GeoControlsProps {
  currentGroupBy: string;
  dateFrom: string;
  dateTo: string;
}

export function GeoControls({ currentGroupBy, dateFrom, dateTo }: GeoControlsProps) {
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
      router.push(`/dashboard/geo?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="geo-controls">
      <div className="control-group">
        <label htmlFor="group-by-select">Group by</label>
        <select
          id="group-by-select"
          value={currentGroupBy}
          onChange={(e) => updateParam('group_by', e.target.value)}
        >
          <option value="country">Country</option>
          <option value="region">Region</option>
          <option value="city">City</option>
        </select>
      </div>

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
    </div>
  );
}
