import { signInWithPassword } from "@/app/login/actions";

type LoginPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Ghstly Ad Analytics Dashboard</p>
        <h1>Sign in</h1>
        <p className="subtle-copy">
          Use the admin account configured in Supabase Auth to access the dashboard.
        </p>

        <form action={signInWithPassword} className="auth-form">
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              className="input"
              name="email"
              placeholder="admin@ghstly.chat"
              required
              type="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              className="input"
              name="password"
              placeholder="Enter your password"
              required
              type="password"
            />
          </label>

          {error ? (
            <p aria-live="polite" className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="primary-button" type="submit">
            Sign in to dashboard
          </button>
        </form>
      </section>
    </main>
  );
}
