import { SearchX } from 'lucide-react';
import { ButtonLink } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';

export function NotFound({ admin = false }: { admin?: boolean }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<SearchX />}
        title="Page not found"
        action={<ButtonLink to={admin ? '/admin' : '/'}>{admin ? 'Back to dashboard' : 'Back to the shop'}</ButtonLink>}
      >
        That link doesn’t go anywhere. It may have been mistyped, or the card may have sold.
      </EmptyState>
    </div>
  );
}
