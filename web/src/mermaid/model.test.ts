import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDiagramTransaction,
  buildSemanticDiagram,
  compareSemanticDiagrams,
  type DiagramOperation,
} from './model';

const source = [
  'flowchart TD',
  '  A[Alpha] -->|yes| B[Beta]',
  '  A -->|no| C[Gamma]',
  '  class A important',
  '  %% preserve this note',
  '%% mdve:position A 10 20',
].join('\n');

test('builds one semantic graph with source provenance and stable parallel-link ids', () => {
  const model = buildSemanticDiagram(source);

  assert.equal(model.capabilities.structuredEditing, true);
  assert.deepEqual(model.nodes.map((node) => node.id), ['A', 'B', 'C']);
  assert.deepEqual(model.nodes[0].position, { x: 10, y: 20 });
  assert.deepEqual(model.edges.map((edge) => edge.id), ['A->B#0', 'A->C#0']);
  assert.equal(model.edges[0].sourceKey, '1:1');
  assert.equal(model.capabilities.preservesOpaqueSource, true);
});

test('applies a named transaction atomically while preserving opaque Mermaid lines', () => {
  const operations: DiagramOperation[] = [
    { kind: 'node.set-label', nodeId: 'A', label: 'Updated' },
    { kind: 'layout.move', nodeId: 'B', position: { x: 40, y: -8 } },
    { kind: 'edge.set-label', edgeId: 'A->B#0', label: 'approved' },
  ];
  const result = applyDiagramTransaction(source, {
    id: 'tx-test',
    title: 'Update decision path',
    operations,
  });

  assert.equal(result.changed, true);
  assert.equal(result.transaction.id, 'tx-test');
  assert.deepEqual(result.transaction.affectedNodes, ['A', 'B']);
  assert.deepEqual(result.transaction.affectedEdges, ['A->B#0']);
  assert.match(result.source, /class A important/);
  assert.match(result.source, /%% preserve this note/);
  assert.match(result.source, /A\[Updated\]/);
  assert.match(result.source, /A\[Updated\] -->\|approved\| B/);
  assert.deepEqual(result.model.nodes.find((node) => node.id === 'B')?.position, { x: 40, y: -8 });
});

test('alignment and distribution are model operations, not UI-only mutations', () => {
  const positioned = applyDiagramTransaction(source, {
    title: 'Seed layout',
    operations: [
      { kind: 'layout.move', nodeId: 'A', position: { x: 10, y: 0 } },
      { kind: 'layout.move', nodeId: 'B', position: { x: 40, y: 5 } },
      { kind: 'layout.move', nodeId: 'C', position: { x: 90, y: 30 } },
    ],
  }).source;
  const aligned = applyDiagramTransaction(positioned, {
    title: 'Align nodes',
    operations: [{ kind: 'layout.align', nodeIds: ['A', 'B', 'C'], axis: 'y' }],
  });
  assert.deepEqual(aligned.model.nodes.map((node) => node.position.y), [0, 0, 0]);

  const distributed = applyDiagramTransaction(aligned.source, {
    title: 'Distribute nodes',
    operations: [{ kind: 'layout.distribute', nodeIds: ['A', 'B', 'C'], axis: 'x' }],
  });
  assert.deepEqual(distributed.model.nodes.map((node) => node.position.x), [10, 50, 90]);
});

test('semantic proposal summaries identify graph and presentation changes', () => {
  const after = applyDiagramTransaction(source, {
    title: 'Proposal',
    origin: 'agent',
    operations: [
      { kind: 'node.set-label', nodeId: 'A', label: 'Renamed' },
      { kind: 'layout.move', nodeId: 'A', position: { x: 22, y: 20 } },
    ],
  }).source;
  assert.deepEqual(compareSemanticDiagrams(source, after), {
    addedNodes: [],
    removedNodes: [],
    changedNodes: ['A'],
    addedEdges: [],
    removedEdges: [],
    changedEdges: [],
    movedNodes: ['A'],
  });
});

test('a failed operation cannot leak a partial transaction', () => {
  assert.throws(
    () => applyDiagramTransaction(source, {
      title: 'Invalid transaction',
      operations: [
        { kind: 'node.set-label', nodeId: 'A', label: 'Would not commit' },
        { kind: 'edge.delete', edgeId: 'missing-edge' },
      ],
    }),
    /Unknown link: missing-edge/,
  );
});
