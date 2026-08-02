import { useEffect, useMemo, useRef, useState } from 'react';

import { supportsStructuredEditing } from '../mermaid/parse';
import { useStore } from '../state/store';
import type { WorkbenchView } from './WorkbenchTabs';

type Command = {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onOpenView,
  onOpenOutline,
  onLibrary,
  focusMode,
  onToggleFocus,
}: {
  open: boolean;
  onClose: () => void;
  onOpenView: (view: WorkbenchView) => void;
  onOpenOutline: () => void;
  onLibrary: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const diagram = useStore((state) => state.diagram);
  const renderError = useStore((state) => state.renderError);
  const session = useStore((state) => state.session);
  const past = useStore((state) => state.past);
  const future = useStore((state) => state.future);
  const agentProposal = useStore((state) => state.agentProposal);
  const applyTransaction = useStore((state) => state.applyTransaction);
  const select = useStore((state) => state.select);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const structuredEditingAvailable = supportsStructuredEditing(diagram, renderError)
    && !session?.archived
    && !session?.trashed
    && !session?.agentLease;

  const dispatchPreviewCommand = (name: 'fit' | 'reset-layout') => {
    window.dispatchEvent(new CustomEvent(`mdve:${name}`));
  };

  const addNode = () => {
    const existing = new Set(diagram.nodes.map((node) => node.id));
    const applied = applyTransaction({ title: 'Add node', operations: [{ kind: 'node.add' }] });
    const added = applied?.model.nodes.find((node) => !existing.has(node.id));
    if (added) {
      onOpenView('preview');
      select({ kind: 'node', id: added.id });
    }
  };

  const commands = useMemo<Command[]>(() => [
    {
      id: 'add-node',
      label: 'Add node',
      description: 'Create a node and select it in the preview',
      shortcut: 'N',
      disabled: !structuredEditingAvailable || Boolean(agentProposal),
      run: addNode,
    },
    {
      id: 'fit-diagram',
      label: 'Fit diagram',
      description: 'Recenter and size the diagram to the canvas',
      shortcut: 'F',
      run: () => dispatchPreviewCommand('fit'),
    },
    {
      id: 'reset-layout',
      label: 'Reset saved layout',
      description: 'Remove saved node and link-label positions',
      disabled: !structuredEditingAvailable,
      run: () => dispatchPreviewCommand('reset-layout'),
    },
    {
      id: 'undo',
      label: 'Undo last edit',
      description: 'Revert the most recent source or canvas transaction',
      shortcut: 'Ctrl Z',
      disabled: past.length === 0,
      run: undo,
    },
    {
      id: 'redo',
      label: 'Redo last edit',
      description: 'Restore the most recently undone transaction',
      shortcut: 'Ctrl Shift Z',
      disabled: future.length === 0,
      run: redo,
    },
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
      id: 'outline',
      label: 'Open outline',
      description: 'Navigate every node and link in the diagram',
      shortcut: 'O',
      run: onOpenOutline,
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
    {
      id: 'focus',
      label: focusMode ? 'Exit focus mode' : 'Focus canvas',
      description: focusMode ? 'Restore the source and context panels' : 'Give the diagram the full workbench stage',
      shortcut: '⌘⇧↵',
      run: onToggleFocus,
    },
  ], [addNode, agentProposal, dispatchPreviewCommand, focusMode, future.length, onLibrary, onOpenOutline, onOpenView, onToggleFocus, past.length, redo, select, structuredEditingAvailable, undo]);

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
    if (!command || command.disabled) return;
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
            <h2 id="command-palette-heading">What do you want to do?</h2>
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
              disabled={command.disabled}
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
