import { useEffect, useState } from 'react';

import { subscribeDiagram } from './api';
import { ChatPanel } from './components/ChatPanel';
import { CodePane } from './components/CodePane';
import { Inspector } from './components/Inspector';
import { HistoryPanel } from './components/HistoryPanel';
import { Preview } from './components/Preview';
import { Toolbar } from './components/Toolbar';
import { WorkbenchTabs, type WorkbenchView } from './components/WorkbenchTabs';
import { flushDiagramBeforeNavigation, useStore } from './state/store';

export function App(): JSX.Element {
  const session = useStore((s) => s.session);
  const loadSession = useStore((s) => s.loadSession);
  const loadProviders = useStore((s) => s.loadProviders);
  const [activeView, setActiveView] = useState<WorkbenchView>('preview');

  useEffect(() => {
    void loadSession(localStorage.getItem('mdve.session') ?? undefined, { startup: true }).catch(() => void loadSession());
    void loadProviders();
  }, [loadSession, loadProviders]);

  // Agent and out-of-band file edits arrive over SSE.
  useEffect(() => {
    if (!session) return;
    return subscribeDiagram(session.id, (source) => {
      useStore.getState().setSource(source, { persist: false });
    });
  }, [session?.id]);

  // A browser cannot reliably finish an asynchronous save during shutdown,
  // so the IndexedDB recovery draft remains the primary guarantee. Warn when
  // the durable save is still in flight or draft journaling has degraded, and
  // make the best-effort flush explicit for normal page-hide navigation.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useStore.getState();
      if (state.saveStatus.state === 'saving' || state.draftStatus === 'degraded') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onPageHide = () => {
      void flushDiagramBeforeNavigation(useStore.getState().session);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

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
      <a className="skip-link" href="#workbench-main">
        Skip to workbench
      </a>
      <Toolbar />
      <WorkbenchTabs activeView={activeView} onChange={setActiveView} />
      <main className="layout" id="workbench-main">
        <section
          className={`pane pane-code${activeView === 'source' ? ' pane-active' : ''}`}
          id="workbench-source"
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
          id="workbench-preview"
          aria-labelledby="preview-heading"
        >
          <header className="pane-header">
            <h2 id="preview-heading">Preview</h2>
            <span>Select a node or link to inspect it</span>
          </header>
          <Preview />
        </section>
        <div
          className={`pane pane-side${activeView === 'inspector' || activeView === 'agent' || activeView === 'history' ? ' pane-active' : ''}${activeView === 'history' ? ' pane-history-active' : ''}`}
        >
          <div
            className={`side-view side-inspector${activeView === 'inspector' ? ' side-view-active' : ''}`}
            id="workbench-inspector"
          >
            <Inspector />
          </div>
          <div
            className={`side-view side-agent${activeView === 'agent' ? ' side-view-active' : ''}`}
            id="workbench-agent"
          >
            <ChatPanel />
          </div>
          <div
            className={`side-view side-history${activeView === 'history' ? ' side-view-active' : ''}`}
            id="workbench-history"
          >
            <HistoryPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
