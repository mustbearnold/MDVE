import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addEdge,
  addNode,
  deleteEdge,
  deleteNode,
  hasOpaqueLinkIndexReferences,
  hasOpaqueNodeReferences,
  renameNodeId,
  setEdgeArrow,
  setEdgeLabel,
  setNodeLabel,
  setNodeShape,
  setDirection,
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
