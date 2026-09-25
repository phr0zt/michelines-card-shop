import { useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Alert, PageSpinner } from '../../components/ui/Feedback';
import { Field, Input } from '../../components/ui/Form';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';

export default function LoginPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const next = params.get('next');
  const target = next && next.startsWith('/admin') ? next : '/admin';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.isLoading) return <PageSpinner />;
  if (session.data?.authenticated) return <Navigate to={target} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await qc.invalidateQueries({ queryKey: ['session'] });
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <LockKeyhole className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Shop admin</h1>
            <p className="text-sm text-muted">Sign in to manage your cards</p>
          </div>
        </div>
        {session.data && !session.data.password_configured ? (
          <Alert tone="warning" title="No admin password yet">
            Set <code className="font-mono text-xs">ADMIN_PASSWORD</code> in the server’s environment (or the
            <code className="font-mono text-xs"> .env</code> file) and restart the server.
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Password" htmlFor="password" error={error}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!password}>
              Sign in
            </Button>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-muted">
          <a href="/" className="underline-offset-2 hover:underline">
            ← Back to the shop
          </a>
        </p>
      </form>
    </div>
  );
}
