export const WORKSPACE_VIEWS = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'agent', label: 'Agent' },
] as const;

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]['id'];

export function WorkspaceTabs({
  activeView,
  onChange,
}: {
  activeView: WorkspaceView;
  onChange: (view: WorkspaceView) => void;
}): JSX.Element {
  return (
    <nav className="workspace-tabs" aria-label="Workspace views">
      {WORKSPACE_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-controls={`workspace-${view.id}`}
          aria-pressed={activeView === view.id}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
