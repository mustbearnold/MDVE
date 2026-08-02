import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addEdge,
  addNode,
  clearLayoutPositions,
  deleteEdge,
  deleteNode,
  edgePositionKey,
  hasOpaqueLinkIndexReferences,
  hasOpaqueNodeReferences,
  readEdgeLabelPositions,
  renameNodeId,
  setEdgeArrow,
  setEdgeLabel,
  setEdgeLabelPosition,
  setNodeLabel,
  setNodePosition,
  setNodeShape,
  setDirection,
  clearNodePositions,
  readNodePositions,
} from './mutate';
import { parseDiagram, supportsStructuredEditing } from './parse';

test('structured insertions refuse unsupported and headerless diagrams', () => {
  const sources = [
    'sequenceDiagram\n  Alice->>Bob: Hi',
    'stateDiagram-v2\n  [*] --> Idle',
    'classDiagram\n  class User',
    'erDiagram\n  USER ||--o{ ORDER : places',
    'mindmap\n  root((MDVE))',
    'A --> B',
  ];

  for (const source of sources) {
    assert.equal(addNode(source).source, source);
    assert.equal(addEdge(source, 'A', 'B'), source);
    assert.equal(setNodeLabel(source, 'A', 'Changed'), source);
    assert.equal(setNodeShape(source, 'A', 'circle'), source);
    assert.equal(renameNodeId(source, 'A', 'Changed'), source);
    assert.equal(setEdgeLabel(source, '1:1', 'Changed'), source);
    assert.equal(setEdgeArrow(source, '1:1', '==>'), source);
    assert.equal(deleteEdge(source, '1:1'), source);
    assert.equal(deleteNode(source, 'A'), source);
    assert.equal(setDirection(source, 'LR'), source);
    assert.equal(supportsStructuredEditing(parseDiagram(source)), false);
  }
});

test('render failures disable the shared structured-editing eligibility rule', () => {
  const diagram = parseDiagram('flowchart TD\n  A --> B');

  assert.equal(supportsStructuredEditing(diagram), true);
  assert.equal(supportsStructuredEditing(diagram, 'render failed'), false);
});

test('all structured mutations refuse a headerless diagram', () => {
  const source = 'A[Alpha] --> B[Beta]';

  assert.equal(setNodeLabel(source, 'A', 'Changed'), source);
  assert.equal(setNodeShape(source, 'A', 'circle'), source);
  assert.equal(renameNodeId(source, 'A', 'Changed'), source);
  assert.equal(setEdgeLabel(source, '0:1', 'Changed'), source);
  assert.equal(setEdgeArrow(source, '0:1', '==>'), source);
  assert.equal(deleteEdge(source, '0:1'), source);
  assert.equal(deleteNode(source, 'A'), source);
});

test('new structured statements stay outside the final subgraph', () => {
  const source = ['flowchart TD', '  subgraph G', '    A --> B', '  end', ''].join('\n');

  assert.equal(
    addNode(source, { id: 'C', label: 'Charlie' }).source,
    ['flowchart TD', '  subgraph G', '    A --> B', '  end', '  C[Charlie]', ''].join('\n'),
  );
  assert.equal(
    addEdge(source, 'A', 'B'),
    ['flowchart TD', '  subgraph G', '    A --> B', '  end', '  A --> B', ''].join('\n'),
  );
});

test('identity-changing edits refuse opaque node references', () => {
  const source = [
    'flowchart TD',
    '  A[Alpha] --> B[Beta]',
    '  class A important',
    '  style A fill:#fff',
  ].join('\n');

  assert.equal(hasOpaqueNodeReferences(source, 'A'), true);
  assert.equal(renameNodeId(source, 'A', 'Renamed'), source);
  assert.equal(deleteNode(source, 'A'), source);
});

test('comments do not block an otherwise complete identity edit', () => {
  const source = ['flowchart TD', '  A[Alpha] --> B[Beta]', '  %% A is the entry point'].join('\n');

  assert.equal(hasOpaqueNodeReferences(source, 'A'), false);
  assert.equal(
    renameNodeId(source, 'A', 'Renamed'),
    ['flowchart TD', '  Renamed[Alpha] --> B[Beta]', '  %% A is the entry point'].join('\n'),
  );
});

test('mutations preserve every unaffected statement byte-for-byte', () => {
  const source = ['flowchart TD', '  A[Alpha]-->B[Beta]', '    C   -.->   D', ''].join('\n');

  assert.equal(
    setNodeLabel(source, 'A', 'Changed'),
    ['flowchart TD', '  A[Changed] --> B[Beta]', '    C   -.->   D', ''].join('\n'),
  );
});

test('link deletion refuses opaque index-based linkStyle references', () => {
  const source = ['flowchart TD', '  A --> B', '  C --> D', '  linkStyle 1 stroke:#f00'].join('\n');

  assert.equal(hasOpaqueLinkIndexReferences(source), true);
  assert.equal(deleteEdge(source, '1:1'), source);
  assert.equal(deleteNode(source, 'A'), source);
});

test('canvas positions round-trip as Mermaid-safe MDVE comments', () => {
  const source = 'flowchart TD\n  A[Alpha] --> B[Beta]\n';
  const positioned = setNodePosition(source, 'A', { x: 42.36, y: -18.04 });

  assert.equal(
    positioned,
    'flowchart TD\n  A[Alpha] --> B[Beta]\n%% mdve:position A 42.4 -18\n',
  );
  assert.deepEqual([...readNodePositions(positioned)], [['A', { x: 42.4, y: -18 }]]);
  assert.equal(setNodePosition(positioned, 'missing', { x: 1, y: 1 }), positioned);
  assert.equal(clearNodePositions(positioned), source);
});

test('identity edits carry or remove durable canvas positions', () => {
  const source = 'flowchart TD\n  A[Alpha] --> B[Beta]\n%% mdve:position A 12 34\n';

  assert.match(renameNodeId(source, 'A', 'Renamed'), /%% mdve:position Renamed 12 34/);
  assert.doesNotMatch(deleteNode(source, 'A'), /mdve:position A/);
});

test('edge label positions use stable endpoint identities and survive layout resets', () => {
  const source = ['flowchart TD', '  A -->|yes| B', '  A -->|no| C', ''].join('\n');
  const diagram = parseDiagram(source);
  const edge = diagram.edges[0];
  assert.ok(edge);
  const identity = edgePositionKey(diagram, edge);
  const positioned = setEdgeLabelPosition(source, edge.key, { x: 12.36, y: -4.04 });

  assert.match(positioned, /%% mdve:edge-label-position A B 0 12\.4 -4/);
  assert.deepEqual([...readEdgeLabelPositions(positioned)], [[identity, { x: 12.4, y: -4 }]]);
  assert.equal(clearLayoutPositions(positioned), source);
  assert.doesNotMatch(deleteEdge(positioned, edge.key), /mdve:edge-label-position A B/);
});

test('deleting a parallel link reindexes the remaining edge-label position', () => {
  const source = ['flowchart TD', '  A -->|one| B', '  A -->|two| B', ''].join('\n');
  const diagram = parseDiagram(source);
  const second = diagram.edges[1];
  assert.ok(second);
  const positioned = setEdgeLabelPosition(source, second.key, { x: 8, y: 9 });
  const deleted = deleteEdge(positioned, diagram.edges[0].key);
  const nextDiagram = parseDiagram(deleted);
  const remaining = nextDiagram.edges[0];
  assert.ok(remaining);
  assert.deepEqual([...readEdgeLabelPositions(deleted)], [[edgePositionKey(nextDiagram, remaining), { x: 8, y: 9 }]]);
});
