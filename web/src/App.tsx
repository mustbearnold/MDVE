import { useEffect } from 'react';

import { subscribeDiagram } from './api';
import { ChatPanel } from './components/ChatPanel';
import { CodePane } from './components/CodePane';
import { Inspector } from './components/Inspector';
import { Preview } from './components/Preview';
import { Toolbar } from './components/Toolbar';
import { useStore } from './state/store';

export function App(): JSX.Element {
  const session = useStore((s) => s.session);
  const loadSession = useStore((s) => s.loadSession);
  const loadProviders = useStore((s) => s.loadProviders);

  useEffect(() => {
    void loadSession(localStorage.getItem('mdve.session') ?? undefined).catch(() => void loadSession());
    void loadProviders();
  }, [loadSession, loadProviders]);

  // Agent and out-of-band file edits arrive over SSE.
  useEffect(() => {
    if (!session) return;
    return subscribeDiagram(session.id, (source) => {
      useStore.getState().setSource(source, { persist: false });
    });
  }, [session?.id]);

  // Global undo/redo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement;
      if (target.closest('.code-pane, input, textarea')) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useStore.getState().undo();
      } else if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
        event.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!session) {
    return <div className="boot">Starting MDVE…</div>;
  }

  return (
    <div className="app">
      <Toolbar />
      <main className="layout">
        <div className="pane pane-code">
          <div className="pane-title">Source</div>
          <CodePane />
        </div>
        <div className="pane pane-preview">
          <Preview />
        </div>
        <div className="pane pane-side">
          <Inspector />
          <ChatPanel />
        </div>
      </main>
    </div>
  );
}
