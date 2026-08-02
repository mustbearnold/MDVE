import { useRef, type RefObject } from 'react';

import { supportsStructuredEditing } from '../mermaid/parse';
import { useStore, type LibraryScope } from '../state/store';
import { Icon } from './Icon';

const DIRECTIONS = [
  { value: 'TD', label: 'Top to bottom' },
  { value: 'LR', label: 'Left to right' },
  { value: 'BT', label: 'Bottom to top' },
  { value: 'RL', label: 'Right to left' },
];

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar(): JSX.Element {
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const applyTransaction = useStore((s) => s.applyTransaction);
  const select = useStore((s) => s.select);
  const diagram = useStore((s) => s.diagram);
  const renderError = useStore((s) => s.renderError);
  const session = useStore((s) => s.session);
  const revision = useStore((s) => s.revision);
  const sessions = useStore((s) => s.sessions);
  const libraryScope = useStore((s) => s.libraryScope);
  const setLibraryScope = useStore((s) => s.setLibraryScope);
  const librarySearch = useStore((s) => s.librarySearch);
  const setLibrarySearch = useStore((s) => s.setLibrarySearch);
  const loadSession = useStore((s) => s.loadSession);
  const newSession = useStore((s) => s.newSession);
  const duplicateSession = useStore((s) => s.duplicateSession);
  const renameSession = useStore((s) => s.renameSession);
  const archiveSession = useStore((s) => s.archiveSession);
  const restoreSession = useStore((s) => s.restoreSession);
  const trashSession = useStore((s) => s.trashSession);
  const permanentlyDeleteSession = useStore((s) => s.permanentlyDeleteSession);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const saveStatus = useStore((s) => s.saveStatus);
  const draftStatus = useStore((s) => s.draftStatus);
  const promoteDraft = useStore((s) => s.promoteDraft);
  const retrySave = useStore((s) => s.retrySave);
  const resolveConflict = useStore((s) => s.resolveConflict);
  const busy = useStore((s) => s.busy);
  const agentProposal = useStore((s) => s.agentProposal);
  const proposalPending = Boolean(agentProposal && agentProposal.after !== agentProposal.before);
  const fileRef = useRef<HTMLInputElement>(null);
  const diagramMenuRef = useRef<HTMLDetailsElement>(null);
  const fileMenuRef = useRef<HTMLDetailsElement>(null);
  const structuredEditingAvailable = supportsStructuredEditing(diagram, renderError) && !session?.archived && !session?.trashed && !session?.agentLease;

  const closeMenu = (ref: RefObject<HTMLDetailsElement | null>) => {
    if (ref.current) ref.current.open = false;
  };

  const exportSvg = () => {
    const svg = document.querySelector('.preview-svg svg');
    if (!svg) return;
    download(`${session?.title ?? 'diagram'}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  };

  const exportPng = () => {
    const svg = document.querySelector('.preview-svg svg') as SVGSVGElement | null;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const scale = 2;
    const data = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = box.width * scale;
      canvas.height = box.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session?.title ?? 'diagram'}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
  };

  const openFile = async (file: File) => {
    const text = await file.text();
    setSource(text);
    if (session) void renameSession(file.name.replace(/\.mmd$/, ''));
  };

  return (
    <header className="toolbar" aria-label="Diagram toolbar">
      <div className="toolbar-context">
        <div className="product-identity">
          <h1 className="brand" title="Mermaid Diagram Visual Editor">
            MDVE
          </h1>
          <span className="product-name">Mermaid editor</span>
        </div>
        <label className="sr-only" htmlFor="diagram-select">
          Diagram
        </label>
        <select
          className="library-scope"
          aria-label="Diagram library"
          value={libraryScope}
          onChange={(event) => setLibraryScope(event.target.value as LibraryScope)}
        >
          <option value="recent">Recent</option>
          <option value="all">All diagrams</option>
          <option value="archived">Archived</option>
          <option value="trash">Trash</option>
        </select>
        <select
          className="diagram-select"
          id="diagram-select"
          value={session?.id ?? ''}
          onChange={(e) => void loadSession(e.target.value)}
          title="Open diagram"
        >
          {sessions.map((s) => (
            <option
              key={s.id}
              value={s.id}
              title={[s.sourceSummary, s.lastActivityAt ? `Last activity ${new Date(s.lastActivityAt).toLocaleString()}` : undefined, s.historyDegraded ? 'Recovery history unavailable' : undefined].filter(Boolean).join(' · ')}
            >
              {s.title}{s.archived ? ' (archived)' : ''}{s.trashed ? ' (Trash)' : ''}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="diagram-search">
          Search diagrams
        </label>
        <input
          className="diagram-search"
          id="diagram-search"
          value={librarySearch}
          placeholder="Search diagrams"
          onChange={(event) => setLibrarySearch(event.target.value)}
        />
        <span className={`save-status save-${proposalPending ? 'saving' : saveStatus.state}`} aria-live="polite">
          {proposalPending ? (
            <><span className="status-dot status-warning" />Proposal pending · base revision {agentProposal?.revision ?? revision}</>
          ) : saveStatus.state === 'error' ? (
            <button className="save-retry" onClick={retrySave} title={saveStatus.message}>
              Save failed · Retry
            </button>
          ) : saveStatus.state === 'saving' ? (
            <><span className="status-dot" />Saving…</>
          ) : saveStatus.state === 'conflict' ? (
            <>
              <span className="status-dot status-warning" />
              Conflict · revision {saveStatus.actualRevision}
              <button className="save-retry" onClick={() => resolveConflict('current')} title="Replace the editor with the current durable version">
                Use current
              </button>
              <button className="save-retry" onClick={() => resolveConflict('local')} title="Save this editor version on top of the current durable version">
                Keep mine
              </button>
              <details className="conflict-details">
                <summary>Inspect current</summary>
                <pre>{saveStatus.currentSource}</pre>
              </details>
            </>
          ) : saveStatus.historyAvailable === false ? (
            <><span className="status-dot status-warning" />Saved · history unavailable</>
          ) : (
            <><span className="status-dot" />Saved · revision {revision}</>
          )}
        </span>
        {draftStatus === 'available' && (
          <span className="save-status save-saving">
            Recovery draft available
            <button className="save-retry" onClick={promoteDraft} title="Save the browser recovery draft as a new Diagram revision">
              Use recovery draft
            </button>
          </span>
        )}
        {draftStatus === 'degraded' && <span className="save-status save-error">Draft recovery unavailable</span>}
      </div>

      <div className="toolbar-group toolbar-edit" aria-label="Edit diagram">
        <button
          className="button-primary"
          disabled={!structuredEditingAvailable}
          title={!structuredEditingAvailable ? 'Structured editing requires a valid flowchart / graph diagram' : undefined}
          onClick={() => {
            const existing = new Set(diagram.nodes.map((node) => node.id));
            const applied = applyTransaction({ title: 'Add node', operations: [{ kind: 'node.add' }] });
            const added = applied?.model.nodes.find((node) => !existing.has(node.id));
            if (added) select({ kind: 'node', id: added.id });
          }}
        >
          <Icon name="plus" />
          Node
        </button>
        <label className="direction-control">
          <span>Flow</span>
          <select
            value={diagram.direction}
            disabled={!structuredEditingAvailable}
            onChange={(e) => applyTransaction({
              title: 'Change diagram direction',
              operations: [{ kind: 'diagram.set-direction', direction: e.target.value }],
            })}
            aria-label="Layout direction"
          >
            {DIRECTIONS.map((direction) => (
              <option key={direction.value} value={direction.value}>
                {direction.value} · {direction.label}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-button" onClick={undo} disabled={past.length === 0} title="Undo" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-button" onClick={redo} disabled={future.length === 0} title="Redo" aria-label="Redo">
          <Icon name="redo" />
        </button>
      </div>

      <details className="toolbar-menu" ref={diagramMenuRef}>
        <summary>Diagram</summary>
        <div className="toolbar-menu-panel">
          <button
            disabled={!session || busy || Boolean(agentProposal)}
            title={agentProposal ? 'Keep or reject the current agent proposal first' : undefined}
            onClick={() => {
              closeMenu(diagramMenuRef);
              void duplicateSession();
            }}
          >
            Duplicate diagram
          </button>
          <button
            onClick={() => {
              closeMenu(diagramMenuRef);
              void newSession();
            }}
          >
            New diagram
          </button>
          {session?.trashed ? (
            <button
              onClick={() => {
                closeMenu(diagramMenuRef);
                void restoreSession();
              }}
            >
              Restore diagram
            </button>
          ) : (
            <>
              {session?.archived ? (
                <button
                  onClick={() => {
                    closeMenu(diagramMenuRef);
                    void restoreSession();
                  }}
                >
                  Restore diagram
                </button>
              ) : (
                <button
                  onClick={() => {
                    closeMenu(diagramMenuRef);
                    void archiveSession();
                  }}
                >
                  Archive diagram
                </button>
              )}
              <button
                onClick={() => {
                  closeMenu(diagramMenuRef);
                  if (window.confirm('Move this diagram to Trash? It will remain recoverable until permanently deleted.')) void trashSession();
                }}
              >
                Move diagram to Trash
              </button>
            </>
          )}
          {session?.trashed && (
            <button
              onClick={() => {
                closeMenu(diagramMenuRef);
                if (window.confirm('Permanently delete this diagram and its recovery history? This cannot be undone.')) void permanentlyDeleteSession();
              }}
            >
              Delete diagram permanently
            </button>
          )}
          <button
            onClick={() => {
              closeMenu(diagramMenuRef);
              const title = prompt('Diagram name', session?.title ?? '');
              if (title) void renameSession(title);
            }}
          >
            Rename diagram
          </button>
        </div>
      </details>

      <details className="toolbar-menu toolbar-file" ref={fileMenuRef}>
        <summary>File</summary>
        <div className="toolbar-menu-panel toolbar-menu-panel-right">
          <button
            onClick={() => {
              closeMenu(fileMenuRef);
              fileRef.current?.click();
            }}
          >
            Open Mermaid file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".mmd,.mermaid,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => {
              closeMenu(fileMenuRef);
              download(`${session?.title ?? 'diagram'}.mmd`, source, 'text/plain');
            }}
          >
            Save Mermaid source
          </button>
          <button
            onClick={() => {
              closeMenu(fileMenuRef);
              exportSvg();
            }}
          >
            Export SVG
          </button>
          <button
            onClick={() => {
              closeMenu(fileMenuRef);
              exportPng();
            }}
          >
            Export PNG
          </button>
        </div>
      </details>
    </header>
  );
}
