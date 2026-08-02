import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { subscribeDiagram } from './api';
import { ActivityRail } from './components/ActivityRail';
import { ChatPanel } from './components/ChatPanel';
import { ChangeTray } from './components/ChangeTray';
import { CodePane } from './components/CodePane';
import { CommandPalette } from './components/CommandPalette';
import { ContextTabs, type ContextView } from './components/ContextTabs';
import { Inspector } from './components/Inspector';
import { HistoryPanel } from './components/HistoryPanel';
import { Toolbar } from './components/Toolbar';
import { WorkbenchTabs, type WorkbenchView } from './components/WorkbenchTabs';
import { flushDiagramBeforeNavigation, useStore } from './state/store';

const MIN_SOURCE_WIDTH = 260;
const MIN_RIGHT_WIDTH = 280;
const MIN_PREVIEW_WIDTH = 440;
const Preview = lazy(() => import('./components/Preview').then((module) => ({ default: module.Preview })));
const OutlinePanel = lazy(() => import('./components/OutlinePanel').then((module) => ({ default: module.OutlinePanel })));

function PreviewSlot(): JSX.Element {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) return <div className="preview-loading" role="status">Loading preview…</div>;
  return (
    <Suspense fallback={<div className="preview-loading" role="status">Loading preview…</div>}>
      <Preview />
    </Suspense>
  );
}

function PanelDivider({
  side,
  width,
  onWidthChange,
  hidden,
}: {
  side: 'source' | 'right';
  width: number;
  onWidthChange: (width: number) => void;
  hidden: boolean;
}): JSX.Element {
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const direction = side === 'source' ? 1 : -1;
  const label = side === 'source' ? 'Resize source panel' : 'Resize right panel';

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onWidthChange(drag.width + direction * (event.clientX - drag.x));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className={`panel-divider${hidden ? ' panel-divider-hidden' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={side === 'source' ? MIN_SOURCE_WIDTH : MIN_RIGHT_WIDTH}
      aria-valuemax={1200}
      aria-valuenow={Math.round(width)}
      tabIndex={hidden ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 16 : -16;
        onWidthChange(width + direction * delta);
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function App(): JSX.Element {
  const session = useStore((s) => s.session);
  const busy = useStore((s) => s.busy);
  const loadSession = useStore((s) => s.loadSession);
  const loadProviders = useStore((s) => s.loadProviders);
  const [activeView, setActiveView] = useState<WorkbenchView>('preview');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(340);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextView, setContextView] = useState<ContextView>('inspector');
  const [focusMode, setFocusMode] = useState(false);
  const layoutRef = useRef<HTMLElement>(null);

  const selectView = useCallback((view: WorkbenchView) => {
    setFocusMode(false);
    setActiveView(view);
    if (view === 'source') setSourcePanelOpen(true);
    if (view === 'preview') setContextView('inspector');
    if (view === 'inspector' || view === 'agent' || view === 'history') {
      setContextView(view);
      setRightPanelOpen(true);
    }
  }, []);

  const focusLibrary = useCallback(() => {
    setFocusMode(false);
    document.querySelector<HTMLSelectElement>('#diagram-select')?.focus();
  }, []);

  const openOutline = useCallback(() => {
    setFocusMode(false);
    setActiveView('inspector');
    setContextView('outline');
    setRightPanelOpen(true);
  }, []);

  const selectContextView = useCallback((view: ContextView) => {
    setFocusMode(false);
    setContextView(view);
    setRightPanelOpen(true);
    setActiveView(view === 'outline' ? 'inspector' : view);
  }, []);

  const openAgent = useCallback((prompt?: string) => {
    setFocusMode(false);
    selectView('agent');
    requestAnimationFrame(() => {
      if (prompt?.trim()) window.dispatchEvent(new CustomEvent<string>('mdve:agent-prompt', { detail: prompt.trim() }));
      else document.querySelector<HTMLTextAreaElement>('#agent-prompt')?.focus();
    });
  }, [selectView]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((current) => !current);
    setActiveView('preview');
  }, []);

  const updatePanelWidth = useCallback((side: 'source' | 'right', requested: number) => {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const otherWidth = side === 'source'
      ? rightPanelOpen ? rightPanelWidth : 0
      : sourcePanelOpen ? sourcePanelWidth : 0;
    const minimum = side === 'source' ? MIN_SOURCE_WIDTH : MIN_RIGHT_WIDTH;
    const maximum = Math.max(minimum, layoutWidth - otherWidth - MIN_PREVIEW_WIDTH - 20);
    const next = Math.round(Math.min(maximum, Math.max(minimum, requested)));
    if (side === 'source') setSourcePanelWidth(next);
    else setRightPanelWidth(next);
  }, [rightPanelOpen, rightPanelWidth, sourcePanelOpen, sourcePanelWidth]);

  useEffect(() => {
    void loadSession(localStorage.getItem('mdve.session') ?? undefined, { startup: true }).catch(() => void loadSession());
    // A page reload can abort the initial provider request before the next
    // application instance starts. Treat that shutdown race like the session
    // bootstrap race instead of surfacing an unhandled browser error.
    void loadProviders().catch(() => undefined);
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        toggleFocusMode();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
      } else if (event.key === 'Escape') {
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (focusMode) setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commandPaletteOpen, focusMode, toggleFocusMode]);

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
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      <a className="skip-link" href="#workbench-main">
        Skip to workbench
      </a>
      <Toolbar />
      <div className="workbench-shell">
        <ActivityRail
          activeView={activeView}
          activeContext={contextView}
          onSelect={selectView}
          onOutline={openOutline}
          onLibrary={focusLibrary}
          onCommand={() => setCommandPaletteOpen(true)}
        />
        <div className="workbench-stage">
          {focusMode && (
            <button className="focus-exit" type="button" aria-label="Exit focus mode" onClick={() => setFocusMode(false)}>
              <span>Exit focus</span>
              <kbd>Esc</kbd>
            </button>
          )}
          <WorkbenchTabs activeView={activeView} onChange={selectView} />
          <main
            className="layout"
            id="workbench-main"
            ref={layoutRef}
            style={{
              gridTemplateColumns: focusMode
                ? 'minmax(0, 1fr)'
                : `${sourcePanelOpen ? `${sourcePanelWidth}px 10px` : '0px 0px'} minmax(0, 1fr) ${rightPanelOpen ? `10px ${rightPanelWidth}px` : '0px 0px'}`,
            }}
          >
            <section
              className={`pane pane-code${activeView === 'source' ? ' pane-active' : ''}${sourcePanelOpen ? '' : ' pane-collapsed'}`}
              id="workbench-source"
              aria-labelledby="source-heading"
            >
              <header className="pane-header">
                <h2 id="source-heading">Source</h2>
                <span>Mermaid</span>
                <button
                  className="panel-close-button desktop-panel-control"
                  type="button"
                  aria-label="Close source panel"
                  title="Close source panel"
                  onClick={() => setSourcePanelOpen(false)}
                >
                  ×
                </button>
              </header>
              <CodePane />
            </section>
            <PanelDivider
              side="source"
              width={sourcePanelWidth}
              onWidthChange={(width) => updatePanelWidth('source', width)}
              hidden={!sourcePanelOpen}
            />
            <section
              className={`pane pane-preview${activeView === 'preview' ? ' pane-active' : ''}`}
              id="workbench-preview"
              aria-labelledby="preview-heading"
            >
              <header className="pane-header">
                <h2 id="preview-heading">Preview</h2>
                <span>Select a node or link to inspect it</span>
              </header>
              <PreviewSlot />
            </section>
            <PanelDivider
              side="right"
              width={rightPanelWidth}
              onWidthChange={(width) => updatePanelWidth('right', width)}
              hidden={!rightPanelOpen}
            />
            <aside
              className={`pane pane-side${activeView === 'inspector' || activeView === 'agent' || activeView === 'history' ? ' pane-active' : ''}${contextView === 'history' ? ' pane-history-active' : ''}${rightPanelOpen ? '' : ' pane-collapsed'}`}
              id="workbench-side"
              aria-label="Right panel"
            >
              <div className="side-panel-actions desktop-panel-control">
                <div className="side-panel-title">
                  <span>Context</span>
                  <strong>{contextView === 'inspector' ? 'Inspect' : contextView === 'outline' ? 'Outline' : contextView === 'agent' ? 'Agent' : 'History'}</strong>
                </div>
                <ContextTabs activeView={contextView} onChange={selectContextView} />
                <button
                  className="panel-close-button"
                  type="button"
                  aria-label="Close right panel"
                  title="Close right panel"
                  onClick={() => setRightPanelOpen(false)}
                >
                  ×
                </button>
              </div>
              <div
                className={`side-view side-inspector${contextView === 'inspector' ? ' side-view-active' : ''}`}
                id="workbench-inspector"
              >
                <Inspector />
              </div>
              <div
                className={`side-view side-agent${contextView === 'agent' ? ' side-view-active' : ''}`}
                id="workbench-agent"
              >
                <ChatPanel />
              </div>
              <div
                className={`side-view side-history${contextView === 'history' ? ' side-view-active' : ''}`}
                id="workbench-history"
              >
                <HistoryPanel />
              </div>
              <div
                className={`side-view side-outline${contextView === 'outline' ? ' side-view-active' : ''}`}
                id="workbench-outline"
              >
                {contextView === 'outline' && (
                  <Suspense fallback={<div className="outline-loading" role="status">Loading outline…</div>}>
                    <OutlinePanel />
                  </Suspense>
                )}
              </div>
            </aside>
            {!sourcePanelOpen && (
              <button
                className="panel-open-button panel-open-source desktop-panel-control"
                type="button"
                aria-label="Open source panel"
                title="Open source panel"
                onClick={() => setSourcePanelOpen(true)}
              >
                Open source
              </button>
            )}
            {!rightPanelOpen && (
              <button
                className="panel-open-button panel-open-right desktop-panel-control"
                type="button"
                aria-label="Open right panel"
                title="Open right panel"
                onClick={() => setRightPanelOpen(true)}
              >
                Open panel
              </button>
            )}
          </main>
          <ChangeTray busy={busy} onOpenAgent={openAgent} />
        </div>
      </div>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenView={selectView}
        onOpenOutline={openOutline}
        onLibrary={focusLibrary}
        focusMode={focusMode}
        onToggleFocus={toggleFocusMode}
      />
    </div>
  );
}
