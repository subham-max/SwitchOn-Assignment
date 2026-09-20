import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

interface BoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MediaVault render error', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error" role="alert">
          <h1>MediaVault could not display this view.</h1>
          <p>Reload the application to recover.</p>
          <button onClick={() => window.location.reload()}>Reload application</button>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
