"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/campaigns", label: "Campaigns" },
  { href: "/dashboard/trends", label: "Trends" },
  { href: "/dashboard/geo", label: "Geo" },
  { href: "/dashboard/sessions", label: "Sessions" },
  { href: "/dashboard/intelligence", label: "Intelligence" },
  { href: "/dashboard/docs", label: "Docs" },
  { href: "/dashboard/sync", label: "Sync" },
];

export function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const qs = periodParam ? `?period=${periodParam}` : "";

  return (
    <nav className="dashboard-nav">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={`${item.href}${qs}`}
            className={`nav-link ${isActive ? "nav-link-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
