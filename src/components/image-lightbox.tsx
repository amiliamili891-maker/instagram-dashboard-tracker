"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdThumbnail } from "@/components/ad-thumbnail";

interface ImageLightboxProps {
  adId: string;
  /** Pre-fetched signed thumbnail URL (from batch endpoint) */
  thumbnailSignedUrl?: string;
  /** Thumbnail display size */
  size?: "sm" | "md" | "lg";
}

export function ImageLightbox({
  adId,
  thumbnailSignedUrl,
  size = "sm",
}: ImageLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  const openLightbox = useCallback(() => {
    previouslyFocusedRef.current = document.activeElement;
    setIsOpen(true);
    setLoading(true);
    setError(false);

    fetch(`/api/storage/full-image?ad_id=${adId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setFullUrl(data.url);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [adId]);

  const closeLightbox = useCallback(() => {
    setIsOpen(false);
    setFullUrl(null);

    // Restore focus to the element that opened the lightbox
    const prev = previouslyFocusedRef.current;
    if (prev && prev instanceof HTMLElement) {
      // Use requestAnimationFrame to ensure the DOM has updated
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

  // Focus the close button when lightbox opens
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  // Handle Escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeLightbox();
        return;
      }

      // Focus trap: cycle Tab/Shift+Tab within the dialog
      if (e.key === "Tab") {
        const closeBtn = closeButtonRef.current;
        if (!closeBtn) return;

        // The only focusable element in the dialog is the close button.
        // Trap focus on it regardless of Tab direction.
        e.preventDefault();
        closeBtn.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeLightbox]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openLightbox}
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          display: "inline-block",
        }}
        aria-label="View full-size creative image"
      >
        <AdThumbnail adId={adId} signedUrl={thumbnailSignedUrl} size={size} />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full-size creative image"
          onClick={closeLightbox}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.85)",
          }}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeLightbox}
            aria-label="Close lightbox"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "rgba(255, 255, 255, 0.15)",
              border: "none",
              color: "#fff",
              fontSize: 24,
              width: 40,
              height: 40,
              borderRadius: "50%",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10000,
            }}
          >
            &times;
          </button>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {loading && (
              <div style={{ color: "#fff", fontSize: 16 }}>
                Loading full-size image...
              </div>
            )}

            {!loading && error && (
              <div style={{ color: "#aaa", fontSize: 14, textAlign: "center" }}>
                Full-size image not available.
              </div>
            )}

            {!loading && !error && fullUrl && (
              <img
                src={fullUrl}
                alt="Full-size ad creative"
                style={{
                  maxWidth: "90vw",
                  maxHeight: "90vh",
                  objectFit: "contain",
                  borderRadius: 8,
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
