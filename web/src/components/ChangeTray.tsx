import { Icon } from './Icon';

export function ChangeTray({
  busy,
  onOpenAgent,
}: {
  busy: boolean;
  onOpenAgent: () => void;
}): JSX.Element {
  return (
    <section className={`change-tray${busy ? ' change-tray-busy' : ''}`} aria-label="Agent change tray">
      <button
        className="change-tray-trigger"
        type="button"
        aria-label={busy ? 'Open running agent turn' : 'Ask MDVE to change this diagram'}
        onClick={onOpenAgent}
      >
        <span className="change-tray-icon" aria-hidden="true">
          <Icon name="agent" />
        </span>
        <span className="change-tray-copy">
          <strong>{busy ? 'Agent is working on this diagram' : 'Ask MDVE to change this diagram'}</strong>
          <small>{busy ? 'Open Agent to follow progress' : 'Describe a change and review it before applying'}</small>
        </span>
        <kbd>Ctrl K</kbd>
      </button>
    </section>
  );
}
