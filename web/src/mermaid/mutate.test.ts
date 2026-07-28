import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addEdge,
  addNode,
  deleteEdge,
  deleteNode,
  hasOpaqueNodeReferences,
  renameNodeId,
  setEdgeArrow,
  setEdgeLabel,
  setNodeLabel,
  setNodeShape,
} from './mutate';

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
  }
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
