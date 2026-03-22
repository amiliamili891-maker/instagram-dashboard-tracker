"use client";

import { useState } from "react";

interface SectionCalloutProps {
  children: React.ReactNode;
}

export function SectionCallout({ children }: SectionCalloutProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="section-callout-wrapper">
      <button
        type="button"
        className="section-callout-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Hide section info" : "Show section info"}
      >
        <span className="callout-icon">i</span>
        <span className="callout-label">{open ? "Hide info" : "How this works"}</span>
        <span className={`callout-chevron ${open ? "callout-chevron-open" : ""}`}>
          &#8250;
        </span>
      </button>
      {open && (
        <div className="section-callout-body">
          {children}
        </div>
      )}
    </div>
  );
}
