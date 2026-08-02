export type ContextView = 'inspector' | 'outline' | 'agent' | 'history';

const CONTEXT_VIEWS: Array<{ id: ContextView; label: string }> = [
  { id: 'inspector', label: 'Inspect' },
  { id: 'outline', label: 'Outline' },
  { id: 'agent', label: 'Agent' },
  { id: 'history', label: 'History' },
];

export function ContextTabs({
  activeView,
  onChange,
}: {
  activeView: ContextView;
  onChange: (view: ContextView) => void;
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
