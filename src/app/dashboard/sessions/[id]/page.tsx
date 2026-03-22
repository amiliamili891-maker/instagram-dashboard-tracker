/**
 * /dashboard/sessions/[id] — Session Detail Page
 *
 * Full session metadata, duration, funnel progression timeline,
 * and transcript status placeholder (messages come in Phase 12).
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { createServiceClient } from '@/lib/supabase/service';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { TranscriptPanel } from './TranscriptPanel';

export const dynamic = 'force-dynamic';

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

interface FunnelStep {
  label: string;
  reached: boolean;
  timestamp?: string | null;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = createServiceClient();

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !session) {
    notFound();
  }

  // Compute duration
  let durationMs: number | null = null;
  if (session.started_at_utc && session.ended_at_utc) {
    durationMs = new Date(session.ended_at_utc).getTime() - new Date(session.started_at_utc).getTime();
  }

  // Build funnel progression
  const funnelSteps: FunnelStep[] = [
    { label: 'Visited', reached: true, timestamp: session.created_at_utc },
    { label: 'Chatted', reached: session.messages_count > 0, timestamp: session.started_at_utc },
    { label: 'Revealed', reached: session.reached_reveal },
    { label: 'Clicked', reached: session.clicked_through },
    { label: 'Converted', reached: session.converted },
  ];

  return (
    <section className="session-detail">
      <header className="session-detail-header">
        <Link href="/dashboard/sessions" className="back-link">
          Back to sessions
        </Link>
        <h1>Session {id.slice(0, 12)}...</h1>
        <span className={`status-badge status-${session.status ?? 'unknown'}`}>
          {session.status ?? 'unknown'}
        </span>
      </header>

      {/* Funnel Progression */}
      <div className="funnel-progression">
        <h2>Funnel Progression</h2>
        <div className="funnel-steps">
          {funnelSteps.map((step, i) => (
            <div
              key={step.label}
              className={`funnel-step ${step.reached ? 'reached' : 'not-reached'}`}
            >
              <span className="step-number">{i + 1}</span>
              <span className="step-label">{step.label}</span>
              {step.timestamp && step.reached && (
                <span className="step-time">{formatTimestamp(step.timestamp)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Metadata */}
      <div className="session-metadata">
        <h2>Session Details</h2>
        <table className="metadata-table">
          <tbody>
            <tr>
              <th>Session ID</th>
              <td>{session.id}</td>
            </tr>
            <tr>
              <th>Created</th>
              <td>{formatTimestamp(session.created_at_utc)}</td>
            </tr>
            <tr>
              <th>Started</th>
              <td>{formatTimestamp(session.started_at_utc)}</td>
            </tr>
            <tr>
              <th>Ended</th>
              <td>{formatTimestamp(session.ended_at_utc)}</td>
            </tr>
            <tr>
              <th>Duration</th>
              <td>{formatDuration(durationMs)}</td>
            </tr>
            <tr>
              <th>Messages</th>
              <td>{session.messages_count}</td>
            </tr>
            <tr>
              <th>Brand</th>
              <td>{session.brand ?? '-'}</td>
            </tr>
            <tr>
              <th>Status</th>
              <td>{session.status ?? '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Join Keys */}
      <div className="session-join-info">
        <h2>Attribution</h2>
        <table className="metadata-table">
          <tbody>
            <tr>
              <th>Campaign ID</th>
              <td className="id-cell">{session.campaign_id || '-'}</td>
            </tr>
            <tr>
              <th>Adset ID</th>
              <td className="id-cell">{session.adset_id || '-'}</td>
            </tr>
            <tr>
              <th>Ad ID</th>
              <td className="id-cell">{session.ad_id || '-'}</td>
            </tr>
            <tr>
              <th>Join Status</th>
              <td>
                <span className={`join-badge join-${session.join_status}`}>
                  {session.join_status}
                </span>
              </td>
            </tr>
            {session.join_issue && (
              <tr>
                <th>Join Issue</th>
                <td>{session.join_issue}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Geo */}
      <div className="session-geo">
        <h2>Location</h2>
        <table className="metadata-table">
          <tbody>
            <tr>
              <th>City</th>
              <td>{session.city || '-'}</td>
            </tr>
            <tr>
              <th>Region</th>
              <td>{session.region || '-'}</td>
            </tr>
            <tr>
              <th>Country</th>
              <td>{session.country || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Transcript — lazy-loaded from Ghstly API with durable caching */}
      <TranscriptPanel
        sessionId={session.id}
        expectedMessageCount={session.messages_count}
      />
    </section>
  );
}
