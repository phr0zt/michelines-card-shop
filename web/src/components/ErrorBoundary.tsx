import { Component, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { Alert } from './ui/Feedback';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the page path) clears the error, so navigating away recovers. */
  resetKey?: string;
  /** Extra way out shown next to "Reload", e.g. a link to Settings. */
  action?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Shows what went wrong and a way out, instead of a blank page, when a page fails to render. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error): void {
    console.error(error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl py-10">
        <Alert
          tone="critical"
          title="Something went wrong showing this page"
          action={
            <div className="flex flex-wrap gap-2">
              {this.props.action}
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          }
        >
          {error.message || 'Unknown error'}
        </Alert>
      </div>
    );
  }
}
