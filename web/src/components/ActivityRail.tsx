import { Icon, type IconName } from './Icon';
import type { ContextView } from './ContextTabs';
import type { WorkbenchView } from './WorkbenchTabs';

type ActivityItem = {
  id: 'library' | 'outline' | WorkbenchView;
  label: string;
  icon: IconName;
};

const ACTIVITY_ITEMS: ActivityItem[] = [
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'source', label: 'Source', icon: 'source' },
  { id: 'preview', label: 'Preview', icon: 'preview' },
  { id: 'outline', label: 'Outline', icon: 'outline' },
  { id: 'inspector', label: 'Inspector', icon: 'inspector' },
  { id: 'agent', label: 'Agent', icon: 'agent' },
  { id: 'history', label: 'History', icon: 'history' },
];

export function ActivityRail({
  activeView,
  activeContext,
  onSelect,
  onOutline,
  onLibrary,
  onCommand,
}: {
  activeView: WorkbenchView;
  activeContext: ContextView;
  onSelect: (view: WorkbenchView) => void;
  onOutline: () => void;
  onLibrary: () => void;
  onCommand: () => void;
}): JSX.Element {
  return (
    <nav className="activity-rail" aria-label="Workbench activity">
      <div className="activity-rail-items">
        {ACTIVITY_ITEMS.map((item) => {
          const isLibrary = item.id === 'library';
          const isOutline = item.id === 'outline';
          const isContextView = item.id === 'inspector' || item.id === 'agent' || item.id === 'history';
          const isActive = !isLibrary && (isOutline
            ? activeContext === 'outline'
            : isContextView
              ? item.id === activeView && activeContext === item.id
              : item.id === activeView);
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
                else if (isOutline) onOutline();
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
