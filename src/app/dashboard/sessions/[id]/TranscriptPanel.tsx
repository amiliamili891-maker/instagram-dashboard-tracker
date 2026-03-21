'use client';

import { useState, useEffect } from 'react';

interface TranscriptMessage {
  id: string;
  message_index: number;
  sender_role: 'user' | 'assistant' | 'system';
  message_text: string;
  created_at: string | null;
}

interface TranscriptPanelProps {
  sessionId: string;
  expectedMessageCount: number;
}

export function TranscriptPanel({ sessionId, expectedMessageCount }: TranscriptPanelProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  async function loadMessages() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setMessages(body.data.messages);
      setCached(body.data.cached);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      setLoading(false);
    }
  }

  async function refreshMessages() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages/refresh`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setMessages(body.data.messages);
      setCached(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh transcript');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (expectedMessageCount > 0) {
      loadMessages();
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, expectedMessageCount]);

  if (expectedMessageCount === 0) {
    return (
      <div className="session-transcript">
        <h2>Transcript</h2>
        <p className="empty-state">No messages in this session.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="session-transcript">
        <h2>Transcript</h2>
        <div className="transcript-loading">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="transcript-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-transcript">
        <h2>Transcript</h2>
        <div className="transcript-error">
          <p>Failed to load transcript: {error}</p>
          <button onClick={loadMessages} className="transcript-retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-transcript">
      <div className="transcript-header">
        <h2>Transcript ({messages.length} messages)</h2>
        <button
          onClick={refreshMessages}
          disabled={refreshing}
          className="transcript-refresh-btn"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {cached && (
        <p className="transcript-cache-note">Loaded from cache</p>
      )}
      <div className="transcript-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`transcript-bubble transcript-${msg.sender_role}`}
          >
            <span className="bubble-role">
              {msg.sender_role === 'user' ? 'User' : msg.sender_role === 'assistant' ? 'AI' : 'System'}
            </span>
            <p className="bubble-text">{msg.message_text}</p>
            {msg.created_at && (
              <span className="bubble-time">
                {new Date(msg.created_at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
