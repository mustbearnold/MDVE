import assert from 'node:assert/strict';
import test from 'node:test';

import { addNode, setNodeLabel, setNodeShape } from './mutate';
import { SHAPES, parseDiagram, reservedIdsIn, supportsStructuredEditing } from './parse';

test('flowchart corpus models every supported shape and representative link syntax', () => {
  const shapeLines = SHAPES.map((shape, index) => `  n${index}${shape.open}Shape ${index}${shape.close}`).join('\n');
  const source = [
    'flowchart LR',
    shapeLines,
    '  n0 -->|yes| n1',
    '  n1 -- no --> n2',
    '  n2 -.-> n3',
    '  n3 ==> n4',
    '  subgraph Group',
    '    nested[Nested] --> n0',
    '  end',
    '  %% byte-preserved comment',
    '  classDef important fill:#fff',
    '  class n0 important',
    '  style n1 stroke:#f00',
  ].join('\n');

  const diagram = parseDiagram(source);
  assert.equal(supportsStructuredEditing(diagram), true);
  for (const [index, shape] of SHAPES.entries()) {
    const node = diagram.nodes.find((candidate) => candidate.id === `n${index}`);
    assert.equal(node?.shape, shape.name);
    assert.equal(node?.label, `Shape ${index}`);
  }
  assert.ok(diagram.edges.some((edge) => edge.label === 'yes'));
  assert.ok(diagram.edges.some((edge) => edge.label === 'no'));
  assert.ok(diagram.lines.some((line) => line.kind === 'raw' && line.raw.includes('byte-preserved comment')));

  const changed = setNodeLabel(source, 'n0', 'Changed');
  assert.match(changed, /n0\[\[Changed\]\]/);
  assert.ok(changed.includes('%% byte-preserved comment'));
  assert.ok(changed.includes('classDef important fill:#fff'));
  assert.ok(changed.includes('style n1 stroke:#f00'));
});

test('reserved ids and unsupported grammars remain outside the structured contract', () => {
  const reserved = 'flowchart TD\n  call[Call] --> end[End]\n  style call fill:#fff';
  assert.deepEqual(reservedIdsIn(reserved).sort(), ['call', 'end']);

  for (const source of [
    'sequenceDiagram\n  Alice->>Bob: Hi',
    'stateDiagram-v2\n  [*] --> Idle',
    'classDiagram\n  class User',
    'erDiagram\n  USER ||--o{ ORDER : places',
    'mindmap\n  root((MDVE))',
  ]) {
    const diagram = parseDiagram(source);
    assert.equal(diagram.unsupported, true);
    assert.equal(supportsStructuredEditing(diagram), false);
    assert.equal(addNode(source).source, source);
  }
});

test('shape and label mutations keep opaque source and edit only modeled statements', () => {
  const source = [
    'flowchart TD',
    '  start([Start]) --> finish{Finish}',
    '  %% do not rewrite this line: start',
    '  classDef terminal fill:#0f0',
    '  class finish terminal',
  ].join('\n');
  const shaped = setNodeShape(source, 'start', 'circle');
  const relabeled = setNodeLabel(shaped, 'finish', 'Done');
  assert.match(relabeled, /start\(\(Start\)\)/);
  assert.match(relabeled, /finish\{Done\}/);
  assert.ok(relabeled.includes('%% do not rewrite this line: start'));
  assert.ok(relabeled.includes('class finish terminal'));
});
