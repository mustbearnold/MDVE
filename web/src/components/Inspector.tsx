import { useEffect, useState } from 'react';

import { SHAPES, ShapeName, isReservedId, supportsStructuredEditing } from '../mermaid/parse';
import { hasOpaqueLinkIndexReferences, hasOpaqueNodeReferences } from '../mermaid/mutate';
import { useStore } from '../state/store';

const ARROWS: { value: string; label: string }[] = [
  { value: '-->', label: 'Arrow' },
  { value: '---', label: 'Line' },
  { value: '-.->', label: 'Dotted' },
  { value: '==>', label: 'Thick' },
  { value: '--o', label: 'Circle end' },
  { value: '--x', label: 'Cross end' },
];

export function Inspector(): JSX.Element {
  const selection = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const diagramModel = useStore((s) => s.diagramModel);
  const source = useStore((s) => s.source);
  const renderError = useStore((s) => s.renderError);
  const applyTransaction = useStore((s) => s.applyTransaction);
  const select = useStore((s) => s.select);

  const node = selection.kind === 'node' ? diagram.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection.kind === 'edge' ? diagram.edges.find((e) => e.key === selection.key) : undefined;

  const [idDraft, setIdDraft] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');

  useEffect(() => setIdDraft(node?.id ?? ''), [node?.id]);

  const idReserved = idDraft.trim() !== '' && isReservedId(idDraft.trim());

  const selectedNodeIds = selection.kind === 'nodes'
    ? selection.ids.filter((id) => diagram.nodes.some((candidate) => candidate.id === id))
    : [];

  if (!supportsStructuredEditing(diagram, renderError)) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="muted">
          Visual editing requires a valid <code>flowchart</code> / <code>graph</code> diagram. Fix the render error,
          edit as text, or ask the agent.
        </p>
      </aside>
    );
  }

  if (node) {
    const opaqueNodeReference = hasOpaqueNodeReferences(source, node.id);
    const connectionCount = diagram.edges.filter((e) => e.from === node.id || e.to === node.id).length;
    const opaqueLinkReference = connectionCount > 0 && hasOpaqueLinkIndexReferences(source);
    const deleteBlocked = opaqueNodeReference || opaqueLinkReference;
    return (
      <aside className="inspector">
        <h2>Node</h2>

        <label>
          Label
          <input
            value={node.label}
            onChange={(e) => applyTransaction({
              title: 'Edit node label',
              operations: [{ kind: 'node.set-label', nodeId: node.id, label: e.target.value }],
            })}
          />
        </label>

        <label>
          Id
          <div className="row">
            <input value={idDraft} onChange={(e) => setIdDraft(e.target.value)} />
            <button
              disabled={idDraft === node.id || idDraft.trim() === '' || idReserved || opaqueNodeReference}
              onClick={() => {
                applyTransaction({
                  title: 'Rename node',
                  operations: [{ kind: 'node.rename', nodeId: node.id, nextId: idDraft.trim() }],
                });
                select({ kind: 'node', id: idDraft.trim() });
              }}
            >
              Rename
            </button>
          </div>
          {idReserved && <span className="field-error">“{idDraft.trim()}” is a Mermaid keyword</span>}
          {opaqueNodeReference && (
            <span className="field-error">Rename unavailable: this id is used by source-only Mermaid syntax.</span>
          )}
        </label>

        <label>
          Shape
          <select
            value={node.shape}
            onChange={(e) => applyTransaction({
              title: 'Change node shape',
              operations: [{ kind: 'node.set-shape', nodeId: node.id, shape: e.target.value as ShapeName }],
            })}
          >
            {SHAPES.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Connect to
          <div className="row">
            <select value={edgeTarget} onChange={(e) => setEdgeTarget(e.target.value)}>
              <option value="">Select node…</option>
              {diagram.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.id})
                  </option>
                ))}
            </select>
            <button
              disabled={!edgeTarget}
              onClick={() => {
                applyTransaction({
                  title: 'Connect nodes',
                  operations: [{ kind: 'edge.add', from: node.id, to: edgeTarget }],
                });
                setEdgeTarget('');
              }}
            >
              Link
            </button>
          </div>
        </label>

        <div className="inspector-meta">
          <span>{connectionCount} connections</span>
        </div>

        <button
          className="danger"
          disabled={deleteBlocked}
          title={deleteBlocked ? 'Delete unavailable while source-only syntax depends on this node or its links' : undefined}
          onClick={() => {
            applyTransaction({ title: 'Delete node', operations: [{ kind: 'node.delete', nodeId: node.id }] });
            select({ kind: 'none' });
          }}
        >
          Delete node
        </button>
      </aside>
    );
  }

  if (selection.kind === 'nodes' && selectedNodeIds.length > 0) {
    const canDelete = selectedNodeIds.every((id) => !hasOpaqueNodeReferences(source, id));
    const edgeIds = diagramModel.edges
      .filter((edge) => selectedNodeIds.includes(edge.from) || selectedNodeIds.includes(edge.to))
      .map((edge) => edge.id);
    return (
      <aside className="inspector inspector-selection">
        <h2>Selection</h2>
        <p className="muted">{selectedNodeIds.length} nodes selected · Shift-click to add or remove nodes.</p>
        <div className="inspector-meta">
          <span>Align or distribute the selection as one edit transaction.</span>
        </div>
        <div className="inspector-action-grid" aria-label="Selection layout actions">
          <button type="button" onClick={() => applyTransaction({ title: 'Align nodes vertically', operations: [{ kind: 'layout.align', nodeIds: selectedNodeIds, axis: 'x' }] })}>
            Align vertical
          </button>
          <button type="button" onClick={() => applyTransaction({ title: 'Align nodes horizontally', operations: [{ kind: 'layout.align', nodeIds: selectedNodeIds, axis: 'y' }] })}>
            Align horizontal
          </button>
          <button type="button" disabled={selectedNodeIds.length < 3} onClick={() => applyTransaction({ title: 'Distribute nodes horizontally', operations: [{ kind: 'layout.distribute', nodeIds: selectedNodeIds, axis: 'x' }] })}>
            Distribute ↔
          </button>
          <button type="button" disabled={selectedNodeIds.length < 3} onClick={() => applyTransaction({ title: 'Distribute nodes vertically', operations: [{ kind: 'layout.distribute', nodeIds: selectedNodeIds, axis: 'y' }] })}>
            Distribute ↕
          </button>
        </div>
        <button
          type="button"
          className="danger"
          disabled={!canDelete || (edgeIds.length > 0 && hasOpaqueLinkIndexReferences(source))}
          onClick={() => {
            applyTransaction({
              title: `Delete ${selectedNodeIds.length} nodes`,
              operations: selectedNodeIds.map((nodeId) => ({ kind: 'node.delete' as const, nodeId })),
            });
            select({ kind: 'none' });
          }}
        >
          Delete selected
        </button>
      </aside>
    );
  }

  if (edge) {
    const deleteBlocked = hasOpaqueLinkIndexReferences(source);
    const semanticEdge = diagramModel.edges.find((candidate) => candidate.sourceKey === edge.key);
    const edgeId = semanticEdge?.id ?? edge.key;
    return (
      <aside className="inspector">
        <h2>Link</h2>
        <p className="muted">
          {edge.from} → {edge.to}
        </p>

        <label>
          Label
          <input
            value={edge.label ?? ''}
            placeholder="none"
            onChange={(e) => applyTransaction({
              title: 'Edit link label',
              operations: [{ kind: 'edge.set-label', edgeId, label: e.target.value }],
            })}
          />
        </label>

        <label>
          Style
          <select value={edge.arrow} onChange={(e) => applyTransaction({
            title: 'Change link style',
            operations: [{ kind: 'edge.set-arrow', edgeId, arrow: e.target.value }],
          })}>
            {ARROWS.some((a) => a.value === edge.arrow) ? null : (
              <option value={edge.arrow}>{edge.arrow}</option>
            )}
            {ARROWS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label} ({a.value})
              </option>
            ))}
          </select>
        </label>

        <button
          className="danger"
          disabled={deleteBlocked}
          title={deleteBlocked ? 'Delete unavailable while source-only linkStyle syntax depends on link indexes' : undefined}
          onClick={() => {
            applyTransaction({ title: 'Delete link', operations: [{ kind: 'edge.delete', edgeId }] });
            select({ kind: 'none' });
          }}
        >
          Delete link
        </button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <h2>Diagram</h2>
      <p className="muted">Click a node or link in the preview to edit it.</p>
      <div className="inspector-meta">
        <span>{diagram.nodes.length} nodes</span>
        <span>{diagram.edges.length} links</span>
        <span>direction {diagram.direction}</span>
      </div>
    </aside>
  );
}
