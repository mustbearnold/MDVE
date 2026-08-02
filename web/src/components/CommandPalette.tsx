import { useEffect, useMemo, useRef, useState } from 'react';

import type { WorkbenchView } from './WorkbenchTabs';

type Command = {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onOpenView,
  onLibrary,
}: {
  open: boolean;
  onClose: () => void;
  onOpenView: (view: WorkbenchView) => void;
  onLibrary: () => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => [
    {
      id: 'library',
      label: 'Open library',
      description: 'Find a diagram in the current workspace',
      shortcut: 'L',
      run: onLibrary,
    },
    {
      id: 'source',
      label: 'Open source',
      description: 'Edit the Mermaid source directly',
      shortcut: 'S',
      run: () => onOpenView('source'),
    },
    {
      id: 'preview',
      label: 'Show preview',
      description: 'Return to the visual diagram canvas',
      shortcut: 'P',
      run: () => onOpenView('preview'),
    },
    {
      id: 'inspector',
      label: 'Inspect selection',
      description: 'Open properties for the selected node or link',
      shortcut: 'I',
      run: () => onOpenView('inspector'),
    },
    {
      id: 'agent',
      label: 'Open agent',
      description: 'Describe a change and review the proposed result',
      shortcut: 'A',
      run: () => onOpenView('agent'),
    },
    {
      id: 'history',
      label: 'Open history',
      description: 'Review durable revisions and recovery points',
      shortcut: 'H',
      run: () => onOpenView('history'),
    },
  ], [onLibrary, onOpenView]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredCommands.length - 1)));
  }, [filteredCommands.length]);

  if (!open) return null;

  const runCommand = (command: Command | undefined) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div
      className="command-palette-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette-header">
          <div>
            <span className="command-palette-eyebrow">MDVE command center</span>
            <h2 id="command-palette-heading">What do you want to open?</h2>
          </div>
          <button type="button" className="command-palette-close" aria-label="Close command palette" onClick={onClose}>
            Esc
          </button>
        </div>
        <input
          ref={inputRef}
          className="command-palette-search"
          type="search"
          aria-label="Search commands"
          placeholder="Search views and actions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, Math.max(0, filteredCommands.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runCommand(filteredCommands[activeIndex]);
            }
          }}
        />
        <div className="command-palette-list">
          {filteredCommands.length > 0 ? filteredCommands.map((command, index) => (
            <button
              key={command.id}
              className={`command-palette-item${activeIndex === index ? ' command-palette-item-active' : ''}`}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand(command)}
            >
              <span className="command-palette-item-copy">
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          )) : (
            <p className="command-palette-empty">No matching commands.</p>
          )}
        </div>
        <footer className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </footer>
      </section>
    </div>
  );
}
