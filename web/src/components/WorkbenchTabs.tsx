export const WORKBENCH_VIEWS = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'agent', label: 'Agent' },
] as const;

export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number]['id'];

export function WorkbenchTabs({
  activeView,
  onChange,
}: {
  activeView: WorkbenchView;
  onChange: (view: WorkbenchView) => void;
}): JSX.Element {
  return (
    <nav className="workbench-tabs" aria-label="Workbench views">
      {WORKBENCH_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-controls={`workbench-${view.id}`}
          aria-pressed={activeView === view.id}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
