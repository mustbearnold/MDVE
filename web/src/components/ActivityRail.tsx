import { Icon, type IconName } from './Icon';
import type { WorkbenchView } from './WorkbenchTabs';

type ActivityItem = {
  id: 'library' | WorkbenchView;
  label: string;
  icon: IconName;
};

const ACTIVITY_ITEMS: ActivityItem[] = [
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'source', label: 'Source', icon: 'source' },
  { id: 'preview', label: 'Preview', icon: 'preview' },
  { id: 'inspector', label: 'Inspector', icon: 'inspector' },
  { id: 'agent', label: 'Agent', icon: 'agent' },
  { id: 'history', label: 'History', icon: 'history' },
];

export function ActivityRail({
  activeView,
  onSelect,
  onLibrary,
  onCommand,
}: {
  activeView: WorkbenchView;
  onSelect: (view: WorkbenchView) => void;
  onLibrary: () => void;
  onCommand: () => void;
}): JSX.Element {
  return (
    <nav className="activity-rail" aria-label="Workbench activity">
      <div className="activity-rail-items">
        {ACTIVITY_ITEMS.map((item) => {
          const isLibrary = item.id === 'library';
          const isActive = !isLibrary && item.id === activeView;
          return (
            <button
              key={item.id}
              className={`activity-rail-button${isActive ? ' activity-rail-button-active' : ''}`}
              type="button"
              aria-label={item.label}
              aria-pressed={isActive}
              title={item.label}
              onClick={() => {
                if (isLibrary) onLibrary();
                else onSelect(item.id as WorkbenchView);
              }}
            >
              <Icon name={item.icon} />
            </button>
          );
        })}
      </div>
      <div className="activity-rail-spacer" />
      <button
        className="activity-rail-button activity-rail-command"
        type="button"
        aria-label="Open command palette"
        title="Open command palette (Ctrl K)"
        onClick={onCommand}
      >
        <Icon name="command" />
      </button>
    </nav>
  );
}
