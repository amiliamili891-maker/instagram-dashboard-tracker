"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PERIOD_OPTIONS, type Period } from "@/lib/date-utils";

export function TimeSelector() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentPeriod = searchParams.get("period") || "7d";

  function handleChange(period: Period) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", period);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="time-selector">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`time-btn ${currentPeriod === opt.value ? "time-btn-active" : ""}`}
          onClick={() => handleChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
