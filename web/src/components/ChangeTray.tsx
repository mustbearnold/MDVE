import { useState } from 'react';

import { Icon } from './Icon';

export function ChangeTray({
  busy,
  onOpenAgent,
}: {
  busy: boolean;
  onOpenAgent: (prompt?: string) => void;
}): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const hasPrompt = prompt.trim().length > 0;
  const submit = () => {
    onOpenAgent(prompt.trim() || undefined);
  };

  return (
    <section className={`change-tray${busy ? ' change-tray-busy' : ''}`} aria-label="Agent change tray">
      <form className="change-tray-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <span className="change-tray-icon" aria-hidden="true">
          <Icon name="agent" />
        </span>
        <label className="change-tray-field" htmlFor="quick-change-request">
          <span className="change-tray-label">Quick change</span>
          <input
            id="quick-change-request"
            aria-label="Quick change request"
            value={prompt}
            disabled={busy}
            placeholder={busy ? 'Agent is working…' : 'Describe a change to this diagram'}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPrompt('');
            }}
          />
        </label>
        <button
          className="change-tray-submit"
          type="submit"
          aria-label={busy ? 'Open running agent turn' : hasPrompt ? 'Open Agent with change request' : 'Ask MDVE to change this diagram'}
          title={busy ? 'Open Agent to follow progress' : 'Open Agent with this request'}
        >
          <span>Open Agent</span>
          <kbd>↵</kbd>
        </button>
      </form>
    </section>
  );
}
