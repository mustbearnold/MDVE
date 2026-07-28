import { useEffect, useState } from 'react';

import { SHAPES, ShapeName, isReservedId, supportsStructuredEditing } from '../mermaid/parse';
import {
  addEdge,
  deleteEdge,
  deleteNode,
  hasOpaqueLinkIndexReferences,
  hasOpaqueNodeReferences,
  renameNodeId,
  setEdgeArrow,
  setEdgeLabel,
  setNodeLabel,
  setNodeShape,
} from '../mermaid/mutate';
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
  const source = useStore((s) => s.source);
  const renderError = useStore((s) => s.renderError);
  const setSource = useStore((s) => s.setSource);
  const select = useStore((s) => s.select);

  const node = selection.kind === 'node' ? diagram.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection.kind === 'edge' ? diagram.edges.find((e) => e.key === selection.key) : undefined;

  const [idDraft, setIdDraft] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');

  useEffect(() => setIdDraft(node?.id ?? ''), [node?.id]);

  const idReserved = idDraft.trim() !== '' && isReservedId(idDraft.trim());

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
            onChange={(e) => setSource(setNodeLabel(source, node.id, e.target.value))}
          />
        </label>

        <label>
          Id
          <div className="row">
            <input value={idDraft} onChange={(e) => setIdDraft(e.target.value)} />
            <button
              disabled={idDraft === node.id || idDraft.trim() === '' || idReserved || opaqueNodeReference}
              onClick={() => {
                setSource(renameNodeId(source, node.id, idDraft.trim()));
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
            onChange={(e) => setSource(setNodeShape(source, node.id, e.target.value as ShapeName))}
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
                setSource(addEdge(source, node.id, edgeTarget));
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
            setSource(deleteNode(source, node.id));
            select({ kind: 'none' });
          }}
        >
          Delete node
        </button>
      </aside>
    );
  }

  if (edge) {
    const deleteBlocked = hasOpaqueLinkIndexReferences(source);
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
            onChange={(e) => setSource(setEdgeLabel(source, edge.key, e.target.value))}
          />
        </label>

        <label>
          Style
          <select value={edge.arrow} onChange={(e) => setSource(setEdgeArrow(source, edge.key, e.target.value))}>
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
            setSource(deleteEdge(source, edge.key));
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
