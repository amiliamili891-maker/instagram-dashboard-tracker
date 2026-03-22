"use client";

import { useEffect, useState } from "react";

interface AdThumbnailProps {
  adId: string;
  /** Pre-fetched signed URL (from batch endpoint) */
  signedUrl?: string;
  size?: "sm" | "md" | "lg";
  /** Optional click handler — when provided, the thumbnail becomes clickable */
  onClick?: () => void;
}

const SIZE_MAP = {
  sm: { width: 40, height: 40 },
  md: { width: 80, height: 80 },
  lg: { width: 200, height: 200 },
};

export function AdThumbnail({ adId, signedUrl, size = "sm", onClick }: AdThumbnailProps) {
  const [url, setUrl] = useState<string | null>(signedUrl ?? null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!signedUrl);

  useEffect(() => {
    if (signedUrl) {
      setUrl(signedUrl);
      setLoading(false);
      return;
    }

    fetch(`/api/storage/thumbnail?ad_id=${adId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setUrl(data.url);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [adId, signedUrl]);

  const { width, height } = SIZE_MAP[size];
  const clickableStyle = onClick ? { cursor: "pointer" as const } : {};

  if (loading) {
    return (
      <div
        className="ad-thumbnail ad-thumbnail-loading"
        style={{ width, height, ...clickableStyle }}
        onClick={onClick}
        role={onClick ? "button" : undefined}
      />
    );
  }

  if (error || !url) {
    return (
      <div
        className="ad-thumbnail ad-thumbnail-placeholder"
        style={{ width, height, ...clickableStyle }}
        title="No creative preview available"
        onClick={onClick}
        role={onClick ? "button" : undefined}
      >
        <span className="ad-thumbnail-icon">&#x1F4F7;</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt="Ad creative"
      width={width}
      height={height}
      className="ad-thumbnail"
      style={{ objectFit: "cover", borderRadius: 4, ...clickableStyle }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      onError={() => setError(true)}
    />
  );
}
