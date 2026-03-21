"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SyncResult {
  syncBatchId: string;
  type: string;
  metaSuccess: boolean;
  ghstlySuccess: boolean;
  metaError?: string;
  ghstlyError?: string;
  durationMs: number;
  totalRetries: number;
}

interface SyncStatus {
  isRunning: boolean;
  runningSyncId: string | null;
}

type ButtonState = "idle" | "syncing" | "success" | "partial" | "error" | "already-running";

export function SyncNowButton() {
  const [state, setState] = useState<ButtonState>("idle");
  const [syncType, setSyncType] = useState<"incremental" | "backfill">("incremental");
  const [backfillDays, setBackfillDays] = useState(14);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, []);

  // Check if a sync is already running on mount
  useEffect(() => {
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((data: SyncStatus) => {
        if (data.isRunning) {
          setState("already-running");
          startPolling();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/sync/status");
        const data: SyncStatus = await res.json();
        if (!data.isRunning) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setState((prev) => (prev === "already-running" ? "idle" : prev));
        }
      } catch {
        // Continue polling
      }
    }, 3000);
  }, []);

  const handleSync = async () => {
    setState("syncing");
    setResult(null);
    setErrorMsg(null);
    setElapsedMs(0);

    // Start elapsed timer
    const startTime = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    startPolling();

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: syncType,
          ...(syncType === "backfill" ? { backfillDays } : {}),
        }),
      });

      // Stop timer and polling
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setErrorMsg(data.error || `HTTP ${res.status}`);
        setState("error");
        return;
      }

      const data: SyncResult = await res.json();
      setResult(data);

      if (data.metaSuccess && data.ghstlySuccess) {
        setState("success");
        dismissRef.current = setTimeout(() => setState("idle"), 10000);
      } else {
        setState("partial");
      }
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  };

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const isDisabled = state === "syncing" || state === "already-running";

  return (
    <div className="sync-now-controls">
      <div className="sync-now-row">
        <select
          className="sync-type-select"
          value={syncType}
          onChange={(e) => setSyncType(e.target.value as "incremental" | "backfill")}
          disabled={isDisabled}
        >
          <option value="incremental">Incremental</option>
          <option value="backfill">Backfill</option>
        </select>

        {syncType === "backfill" && (
          <input
            type="number"
            className="backfill-days-input"
            value={backfillDays}
            onChange={(e) => setBackfillDays(Math.min(Math.max(Number(e.target.value) || 1, 1), 90))}
            min={1}
            max={90}
            disabled={isDisabled}
          />
        )}

        <button
          className={`sync-now-btn sync-now-${state}`}
          onClick={handleSync}
          disabled={isDisabled}
        >
          {state === "syncing" && (
            <>
              <span className="sync-spinner" />
              Syncing... {formatElapsed(elapsedMs)}
            </>
          )}
          {state === "already-running" && "Sync in progress..."}
          {state === "idle" && "Sync Now"}
          {state === "success" && "Sync Now"}
          {state === "partial" && "Sync Now"}
          {state === "error" && "Try Again"}
        </button>
      </div>

      {/* Result display */}
      {state === "success" && result && (
        <div className="sync-result sync-result-success">
          Meta: OK | Ghstly: OK ({(result.durationMs / 1000).toFixed(1)}s)
        </div>
      )}

      {state === "partial" && result && (
        <div className="sync-result sync-result-partial">
          Meta: {result.metaSuccess ? "OK" : `Failed — ${result.metaError}`}
          {" | "}
          Ghstly: {result.ghstlySuccess ? "OK" : `Failed — ${result.ghstlyError}`}
        </div>
      )}

      {state === "error" && errorMsg && (
        <div className="sync-result sync-result-error">
          Sync failed: {errorMsg}
        </div>
      )}
    </div>
  );
}
