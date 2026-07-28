import { useEffect, useState } from 'react';

import { subscribeDiagram } from './api';
import { ChatPanel } from './components/ChatPanel';
import { CodePane } from './components/CodePane';
import { Inspector } from './components/Inspector';
import { Preview } from './components/Preview';
import { Toolbar } from './components/Toolbar';
import { WorkspaceTabs, type WorkspaceView } from './components/WorkspaceTabs';
import { useStore } from './state/store';

export function App(): JSX.Element {
  const session = useStore((s) => s.session);
  const loadSession = useStore((s) => s.loadSession);
  const loadProviders = useStore((s) => s.loadProviders);
  const [activeView, setActiveView] = useState<WorkspaceView>('preview');

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
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      <Toolbar />
      <WorkspaceTabs activeView={activeView} onChange={setActiveView} />
      <main className="layout" id="workspace-main">
        <section
          className={`pane pane-code${activeView === 'source' ? ' pane-active' : ''}`}
          id="workspace-source"
          aria-labelledby="source-heading"
        >
          <header className="pane-header">
            <h2 id="source-heading">Source</h2>
            <span>Mermaid</span>
          </header>
          <CodePane />
        </section>
        <section
          className={`pane pane-preview${activeView === 'preview' ? ' pane-active' : ''}`}
          id="workspace-preview"
          aria-labelledby="preview-heading"
        >
          <header className="pane-header">
            <h2 id="preview-heading">Preview</h2>
            <span>Select a node or link to inspect it</span>
          </header>
          <Preview />
        </section>
        <div
          className={`pane pane-side${activeView === 'inspector' || activeView === 'agent' ? ' pane-active' : ''}`}
        >
          <div
            className={`side-view side-inspector${activeView === 'inspector' ? ' side-view-active' : ''}`}
            id="workspace-inspector"
          >
            <Inspector />
          </div>
          <div
            className={`side-view side-agent${activeView === 'agent' ? ' side-view-active' : ''}`}
            id="workspace-agent"
          >
            <ChatPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
