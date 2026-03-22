/**
 * Overview Shell — Simple layout wrapper for the overview page.
 * Previously managed freshness state client-side; now data flows
 * from the server component page via props to each child.
 */

export function OverviewShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
