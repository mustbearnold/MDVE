import type { WorkbenchView } from './WorkbenchTabs';

const CONTEXT_VIEWS: Array<{ id: Extract<WorkbenchView, 'inspector' | 'agent' | 'history'>; label: string }> = [
  { id: 'inspector', label: 'Inspect' },
  { id: 'agent', label: 'Agent' },
  { id: 'history', label: 'History' },
];

export function ContextTabs({
  activeView,
  onChange,
}: {
  activeView: Extract<WorkbenchView, 'inspector' | 'agent' | 'history'>;
  onChange: (view: WorkbenchView) => void;
}): JSX.Element {
  return (
    <nav className="side-context-tabs" aria-label="Context panel views">
      {CONTEXT_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={activeView === view.id}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
