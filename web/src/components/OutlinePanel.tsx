import { useMemo, useState } from 'react';

import { shapeLabel } from '../mermaid/parse';
import { useStore, type Selection } from '../state/store';
import { Icon } from './Icon';

function labelForNode(nodes: Array<{ id: string; label: string }>, id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id;
}

export function OutlinePanel(): JSX.Element {
  const diagram = useStore((state) => state.diagram);
  const selection = useStore((state) => state.selection);
  const select = useStore((state) => state.select);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const nodes = useMemo(
    () => diagram.nodes.filter((node) => `${node.label} ${node.id} ${shapeLabel(node.shape)}`.toLowerCase().includes(needle)),
    [diagram.nodes, needle],
  );
  const edges = useMemo(() => diagram.edges.filter((edge) => {
    const from = labelForNode(diagram.nodes, edge.from);
    const to = labelForNode(diagram.nodes, edge.to);
    return `${from} ${to} ${edge.from} ${edge.to} ${edge.label ?? ''}`.toLowerCase().includes(needle);
  }), [diagram.edges, diagram.nodes, needle]);
  const connectionCount = (id: string) => diagram.edges.filter((edge) => edge.from === id || edge.to === id).length;
  const selectItem = (next: Selection) => select(next);

  return (
    <section className="outline" aria-labelledby="outline-heading">
      <header className="outline-header">
        <div>
          <span className="outline-eyebrow">Diagram map</span>
          <h2 id="outline-heading">Outline</h2>
        </div>
        <span className="outline-total" aria-label={`${diagram.nodes.length} nodes and ${diagram.edges.length} links`}>
          {diagram.nodes.length + diagram.edges.length}
        </span>
      </header>

      <div className="outline-filter">
        <label htmlFor="outline-filter-input">Filter outline</label>
        <input
          id="outline-filter-input"
          type="search"
          value={query}
          placeholder="Search nodes and links"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="outline-scroll">
        {diagram.nodes.length === 0 ? (
          <div className="outline-empty">
            <Icon name="outline" />
            <strong>No structured nodes yet</strong>
            <p>Build a flowchart in Source or ask Agent to create one.</p>
          </div>
        ) : (
          <>
            <section className="outline-section" aria-labelledby="outline-nodes-heading">
              <header className="outline-section-header">
                <h3 id="outline-nodes-heading">Nodes</h3>
                <span>{nodes.length}/{diagram.nodes.length}</span>
              </header>
              {nodes.length > 0 ? (
                <ul className="outline-list">
                  {nodes.map((node) => {
                    const active = (selection.kind === 'node' && selection.id === node.id) || (selection.kind === 'nodes' && selection.ids.includes(node.id));
                    return (
                      <li key={node.id}>
                        <button
                          className={`outline-item${active ? ' outline-item-active' : ''}`}
                          type="button"
                          aria-pressed={active}
                          aria-label={`Select node ${node.label} (${node.id})`}
                          onClick={(event) => {
                            if (!event.shiftKey) {
                              selectItem({ kind: 'node', id: node.id });
                              return;
                            }
                            const ids = selection.kind === 'nodes'
                              ? selection.ids
                              : selection.kind === 'node' ? [selection.id] : [];
                            const next = ids.includes(node.id) ? ids.filter((id) => id !== node.id) : [...ids, node.id];
                            selectItem(next.length > 0 ? { kind: 'nodes', ids: next } : { kind: 'none' });
                          }}
                        >
                          <span className="outline-item-icon" aria-hidden="true"><Icon name="node" /></span>
                          <span className="outline-item-copy">
                            <strong>{node.label}</strong>
                            <small>{node.id} · {shapeLabel(node.shape)}</small>
                          </span>
                          <span className="outline-item-meta">{connectionCount(node.id)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="outline-no-results">No matching nodes.</p>
              )}
            </section>

            <section className="outline-section" aria-labelledby="outline-links-heading">
              <header className="outline-section-header">
                <h3 id="outline-links-heading">Links</h3>
                <span>{edges.length}/{diagram.edges.length}</span>
              </header>
              {edges.length > 0 ? (
                <ul className="outline-list">
                  {edges.map((edge) => {
                    const active = selection.kind === 'edge' && selection.key === edge.key;
                    const from = labelForNode(diagram.nodes, edge.from);
                    const to = labelForNode(diagram.nodes, edge.to);
                    return (
                      <li key={edge.key}>
                        <button
                          className={`outline-item outline-link-item${active ? ' outline-item-active' : ''}`}
                          type="button"
                          aria-pressed={active}
                          aria-label={`Select link ${from} to ${to}${edge.label ? ` labeled ${edge.label}` : ''}`}
                          onClick={() => selectItem({ kind: 'edge', key: edge.key })}
                        >
                          <span className="outline-item-icon" aria-hidden="true"><Icon name="link" /></span>
                          <span className="outline-item-copy">
                            <strong>{from} <span aria-hidden="true">→</span> {to}</strong>
                            <small>{edge.label ? `“${edge.label}” · ` : ''}{edge.arrow}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="outline-no-results">No matching links.</p>
              )}
            </section>
          </>
        )}
      </div>

      {selection.kind !== 'none' && (
        <footer className="outline-footer">
          <span>{selection.kind === 'nodes' ? `${selection.ids.length} nodes selected` : `Selected ${selection.kind}`}</span>
          <button type="button" onClick={() => select({ kind: 'none' })}>Clear</button>
        </footer>
      )}
    </section>
  );
}
