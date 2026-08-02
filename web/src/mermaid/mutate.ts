/**
 * Structured edits over Mermaid flowchart source.
 *
 * Every operation parses the source, rewrites only the affected lines, and
 * re-serializes. Lines the parser does not understand are never touched.
 */

import {
  Diagram,
  Line,
  NodeToken,
  ShapeName,
  StatementLine,
  isReservedId,
  parseDiagram,
  serializeDiagram,
  supportsStructuredEditing,
} from './parse';

function cloneLines(diagram: Diagram): Line[] {
  return diagram.lines.map((line) =>
    line.kind === 'statement'
      ? { ...line, tokens: line.tokens.map((t) => ({ ...t })) }
      : { ...line },
  );
}

function statements(lines: Line[]): StatementLine[] {
  return lines.filter((l): l is StatementLine => l.kind === 'statement');
}

/**
 * Append new top-level statements after the diagram body, but before trailing
 * blank lines. Inserting after the last parsed statement can accidentally put a
 * new node inside the final subgraph because `end` is deliberately opaque.
 */
function insertionIndex(lines: Line[]): number {
  let index = lines.length;
  while (index > 0) {
    const line = lines[index - 1];
    if (
      line.kind !== 'raw' ||
      (line.raw.trim() !== '' && !isNodePositionLine(line.raw) && !isEdgePositionLine(line.raw))
    ) {
      break;
    }
    index--;
  }
  return index;
}

function defaultIndent(): string {
  return '  ';
}

export interface NodePosition {
  x: number;
  y: number;
}

const NODE_POSITION_RE = /^\s*%%\s*mdve:position\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/i;
const EDGE_POSITION_RE = /^\s*%%\s*mdve:edge-label-position\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)\s+(\d+)\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/i;

function formatPosition(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function isNodePositionLine(line: string): boolean {
  return NODE_POSITION_RE.test(line);
}

function edgeMetadataKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}#${ordinal}`;
}

function isEdgePositionLine(line: string): boolean {
  return EDGE_POSITION_RE.test(line);
}

/**
 * Reads MDVE's presentation-only node offsets from Mermaid comments. Mermaid
 * ignores these lines, while keeping them in the canonical source makes a
 * canvas move durable, undoable, exportable, and safe for the existing file
 * based revision contract.
 */
export function readNodePositions(source: string): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  for (const line of source.split('\n')) {
    const match = NODE_POSITION_RE.exec(line);
    if (!match) continue;
    positions.set(match[1], { x: Number(match[2]), y: Number(match[3]) });
  }
  return positions;
}

function replaceNodePositionMetadata(source: string, id: string, position: NodePosition): string {
  const lines = source.split('\n');
  const metadata = `%% mdve:position ${id} ${formatPosition(position.x)} ${formatPosition(position.y)}`;
  const existing = lines.findIndex((line) => {
    const match = NODE_POSITION_RE.exec(line);
    return match?.[1] === id;
  });
  if (existing >= 0) lines[existing] = metadata;
  else {
    let at = lines.length;
    while (at > 0 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, metadata);
  }
  return lines.join('\n');
}

export function setNodePosition(source: string, id: string, position: NodePosition): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id)) return source;
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram) || !diagram.nodes.some((node) => node.id === id)) return source;
  return replaceNodePositionMetadata(source, id, position);
}

export function clearNodePositions(source: string): string {
  return source
    .split('\n')
    .filter((line) => !isNodePositionLine(line))
    .join('\n');
}

/** Gives parallel links a stable presentation identity without changing their Mermaid key. */
export function edgePositionKey(diagram: Diagram, edge: Diagram['edges'][number]): string {
  let ordinal = 0;
  for (const candidate of diagram.edges) {
    if (candidate.from !== edge.from || candidate.to !== edge.to) continue;
    if (candidate.key === edge.key) return edgeMetadataKey(edge.from, edge.to, ordinal);
    ordinal++;
  }
  return edgeMetadataKey(edge.from, edge.to, ordinal);
}

export function readEdgeLabelPositions(source: string): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  for (const line of source.split('\n')) {
    const match = EDGE_POSITION_RE.exec(line);
    if (!match) continue;
    positions.set(edgeMetadataKey(match[1], match[2], Number(match[3])), { x: Number(match[4]), y: Number(match[5]) });
  }
  return positions;
}

export function setEdgeLabelPosition(source: string, key: string, position: NodePosition): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const edge = diagram.edges.find((candidate) => candidate.key === key);
  if (!edge) return source;
  const identity = edgePositionKey(diagram, edge);
  const lines = source.split('\n');
  const metadata = `%% mdve:edge-label-position ${edge.from} ${edge.to} ${identity.split('#')[1]} ${formatPosition(position.x)} ${formatPosition(position.y)}`;
  const existing = lines.findIndex((line) => {
    const match = EDGE_POSITION_RE.exec(line);
    return match && edgeMetadataKey(match[1], match[2], Number(match[3])) === identity;
  });
  if (existing >= 0) lines[existing] = metadata;
  else {
    let at = lines.length;
    while (at > 0 && lines[at - 1].trim() === '') at--;
    while (at > 0 && (isNodePositionLine(lines[at - 1]) || isEdgePositionLine(lines[at - 1]))) at--;
    lines.splice(at, 0, metadata);
  }
  return lines.join('\n');
}

export function clearEdgeLabelPositions(source: string): string {
  return source
    .split('\n')
    .filter((line) => !isEdgePositionLine(line))
    .join('\n');
}

export function clearLayoutPositions(source: string): string {
  return source
    .split('\n')
    .filter((line) => !isNodePositionLine(line) && !isEdgePositionLine(line))
    .join('\n');
}

function renameNodePositionMetadata(source: string, oldId: string, newId: string): string {
  return source
    .split('\n')
    .map((line) => {
      const match = NODE_POSITION_RE.exec(line);
      return match?.[1] === oldId
        ? `%% mdve:position ${newId} ${formatPosition(Number(match[2]))} ${formatPosition(Number(match[3]))}`
        : line;
    })
    .join('\n');
}

function renameEdgePositionMetadata(source: string, oldId: string, newId: string): string {
  return source
    .split('\n')
    .map((line) => {
      const match = EDGE_POSITION_RE.exec(line);
      if (!match) return line;
      const from = match[1] === oldId ? newId : match[1];
      const to = match[2] === oldId ? newId : match[2];
      return `%% mdve:edge-label-position ${from} ${to} ${match[3]} ${formatPosition(Number(match[4]))} ${formatPosition(Number(match[5]))}`;
    })
    .join('\n');
}

function removeNodePositionMetadata(source: string, id: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const node = NODE_POSITION_RE.exec(line);
      if (node) return node[1] !== id;
      const edge = EDGE_POSITION_RE.exec(line);
      return !edge || (edge[1] !== id && edge[2] !== id);
    })
    .join('\n');
}

function reindexEdgePositionMetadata(source: string, deletedIdentity: string): string {
  const deleted = /^(.*)->(.*)#(\d+)$/.exec(deletedIdentity);
  if (!deleted) return source;
  const deletedFrom = deleted[1];
  const deletedTo = deleted[2];
  const deletedOrdinal = Number(deleted[3]);

  return source
    .split('\n')
    .filter((line) => {
      const match = EDGE_POSITION_RE.exec(line);
      if (!match) return true;
      return !(
        match[1] === deletedFrom &&
        match[2] === deletedTo &&
        Number(match[3]) === deletedOrdinal
      );
    })
    .map((line) => {
      const match = EDGE_POSITION_RE.exec(line);
      if (!match || match[1] !== deletedFrom || match[2] !== deletedTo) return line;
      const ordinal = Number(match[3]);
      const nextOrdinal = ordinal > deletedOrdinal ? ordinal - 1 : ordinal;
      return `%% mdve:edge-label-position ${match[1]} ${match[2]} ${nextOrdinal} ${formatPosition(Number(match[4]))} ${formatPosition(Number(match[5]))}`;
    })
    .join('\n');
}

function reindex(lines: Line[]): Line[] {
  return lines.map((line, index) => ({ ...line, index }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Identity-changing edits cannot safely leave an opaque directive or statement
 * pointing at the old node id. Be conservative until that syntax is modeled.
 */
export function hasOpaqueNodeReferences(source: string, id: string): boolean {
  const diagram = parseDiagram(source);
  const token = new RegExp(`(^|[^A-Za-z0-9_.-])${escapeRegExp(id)}(?=$|[^A-Za-z0-9_.-])`);
  return diagram.lines.some((line) => {
    if (line.kind !== 'raw' || line.index === diagram.headerLine) return false;
    if (line.raw.trimStart().startsWith('%%')) return false;
    return token.test(line.raw);
  });
}

/** Deleting links can renumber Mermaid's opaque index-based linkStyle rules. */
export function hasOpaqueLinkIndexReferences(source: string): boolean {
  return parseDiagram(source).lines.some(
    (line) => line.kind === 'raw' && /^\s*linkStyle\b/i.test(line.raw),
  );
}

export function setNodeLabel(source: string, id: string, label: string): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  let applied = false;

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind !== 'node' || token.id !== id) continue;
      if (token.label !== undefined) {
        token.label = label;
        line.modified = true;
        applied = true;
      }
    }
  }

  if (!applied) {
    // Node was only ever referenced bare — attach the label to its first use.
    outer: for (const line of statements(lines)) {
      for (const token of line.tokens) {
        if (token.kind === 'node' && token.id === id) {
          token.label = label;
          token.shape = token.shape ?? 'rect';
          line.modified = true;
          applied = true;
          break outer;
        }
      }
    }
  }

  return applied ? serializeDiagram(lines) : source;
}

export function setNodeShape(source: string, id: string, shape: ShapeName): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  const node = diagram.nodes.find((n) => n.id === id);
  const label = node?.label ?? id;
  let applied = false;

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind !== 'node' || token.id !== id) continue;
      if (token.label !== undefined) {
        token.shape = shape;
        line.modified = true;
        applied = true;
      }
    }
  }

  if (!applied) {
    outer: for (const line of statements(lines)) {
      for (const token of line.tokens) {
        if (token.kind === 'node' && token.id === id) {
          token.label = label;
          token.shape = shape;
          line.modified = true;
          applied = true;
          break outer;
        }
      }
    }
  }

  return applied ? serializeDiagram(lines) : source;
}

export function renameNodeId(source: string, oldId: string, newId: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(newId)) return source;
  if (isReservedId(newId)) return source;
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram) || hasOpaqueNodeReferences(source, oldId)) return source;
  if (diagram.nodes.some((n) => n.id === newId)) return source;
  const lines = cloneLines(diagram);

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind === 'node' && token.id === oldId) {
        token.id = newId;
        line.modified = true;
      }
    }
  }
  return renameEdgePositionMetadata(renameNodePositionMetadata(serializeDiagram(lines), oldId, newId), oldId, newId);
}

export function addNode(
  source: string,
  opts: { id?: string; label?: string; shape?: ShapeName } = {},
): { source: string; id: string } {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return { source, id: opts.id ?? '' };
  const existing = new Set(diagram.nodes.map((n) => n.id));
  let id = opts.id;
  if (!id || existing.has(id) || isReservedId(id)) {
    let n = diagram.nodes.length + 1;
    do {
      id = `n${n++}`;
    } while (existing.has(id));
  }

  const lines = cloneLines(diagram);
  const token: NodeToken = {
    kind: 'node',
    id,
    label: opts.label ?? 'New node',
    shape: opts.shape ?? 'rect',
  };
  const at = insertionIndex(lines);
  lines.splice(at, 0, {
    kind: 'statement',
    index: at,
    indent: defaultIndent(),
    tokens: [token],
    trailing: '',
    raw: '',
  });

  return { source: serializeDiagram(reindex(lines)), id };
}

export function addEdge(
  source: string,
  from: string,
  to: string,
  opts: { arrow?: string; label?: string } = {},
): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  const at = insertionIndex(lines);
  lines.splice(at, 0, {
    kind: 'statement',
    index: at,
    indent: defaultIndent(),
    tokens: [
      { kind: 'node', id: from },
      { kind: 'link', arrow: opts.arrow ?? '-->', label: opts.label, labelStyle: 'pipe' },
      { kind: 'node', id: to },
    ],
    trailing: '',
    raw: '',
  });
  return serializeDiagram(reindex(lines));
}

export function setEdgeLabel(source: string, key: string, label: string): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;
  const token = line.tokens[tokenIndex];
  if (!token || token.kind !== 'link') return source;
  token.label = label || undefined;
  token.labelStyle = 'pipe';
  line.modified = true;
  return serializeDiagram(lines);
}

export function setEdgeArrow(source: string, key: string, arrow: string): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;
  const token = line.tokens[tokenIndex];
  if (!token || token.kind !== 'link') return source;
  token.arrow = arrow;
  line.modified = true;
  return serializeDiagram(lines);
}

/**
 * Removes one link from a chain. `A --> B --> C` minus the first link becomes
 * two statements so that no node silently loses its definition.
 */
export function deleteEdge(source: string, key: string): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram) || hasOpaqueLinkIndexReferences(source)) return source;
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;
  const edge = diagram.edges.find((candidate) => candidate.key === key);
  if (!edge) return source;

  const left = line.tokens.slice(0, tokenIndex);
  const right = line.tokens.slice(tokenIndex + 1);
  const replacements: Line[] = [];
  for (const tokens of [left, right]) {
    if (tokens.length === 0) continue;
    replacements.push({
      kind: 'statement',
      index: lineIndex,
      indent: line.indent,
      tokens,
      trailing: '',
      raw: '',
    });
  }
  if (line.trailing && replacements.length > 0) {
    (replacements[replacements.length - 1] as StatementLine).trailing = line.trailing;
  }

  lines.splice(lineIndex, 1, ...replacements);
  const nextSource = serializeDiagram(reindex(lines));
  return reindexEdgePositionMetadata(nextSource, edgePositionKey(diagram, edge));
}

/** Deletes a node and every link that touches it. */
export function deleteNode(source: string, id: string): string {
  const diagram = parseDiagram(source);
  const deletesLinks = diagram.edges.some((edge) => edge.from === id || edge.to === id);
  if (
    !supportsStructuredEditing(diagram) ||
    hasOpaqueNodeReferences(source, id) ||
    (deletesLinks && hasOpaqueLinkIndexReferences(source))
  ) {
    return source;
  }
  const lines = cloneLines(diagram);
  const out: Line[] = [];

  for (const line of lines) {
    if (line.kind !== 'statement') {
      out.push(line);
      continue;
    }

    const hasNode = line.tokens.some((t) => t.kind === 'node' && t.id === id);
    if (!hasNode) {
      out.push(line);
      continue;
    }

    // Split the chain on every occurrence of the deleted node, dropping the
    // links that attached to it.
    const runs: { tokens: (typeof line.tokens)[number][] }[] = [];
    let run: (typeof line.tokens)[number][] = [];

    for (const token of line.tokens) {
      if (token.kind === 'node' && token.id === id) {
        if (run.length > 0) {
          while (run.length > 0 && run[run.length - 1].kind === 'link') run.pop();
          if (run.length > 0) runs.push({ tokens: run });
        }
        run = [];
        continue;
      }
      if (run.length === 0 && token.kind === 'link') continue;
      run.push(token);
    }
    while (run.length > 0 && run[run.length - 1].kind === 'link') run.pop();
    if (run.length > 0) runs.push({ tokens: run });

    for (const { tokens } of runs) {
      // A lone bare id left behind carries no information; drop it.
      if (tokens.length === 1 && tokens[0].kind === 'node' && tokens[0].label === undefined) continue;
      out.push({
        kind: 'statement',
        index: line.index,
        indent: line.indent,
        tokens,
        trailing: '',
        raw: '',
      });
    }
  }

  return removeNodePositionMetadata(serializeDiagram(reindex(out)), id);
}

export function setDirection(source: string, direction: string): string {
  const diagram = parseDiagram(source);
  if (!supportsStructuredEditing(diagram)) return source;
  const lines = cloneLines(diagram);
  const header = lines[diagram.headerLine];
  const kind = diagram.header ?? 'flowchart';
  header.raw = header.raw.replace(
    /^(\s*)(flowchart|graph)\s+\w*\s*$/i,
    (_m, indent: string) => `${indent}${kind} ${direction}`,
  );
  return serializeDiagram(lines);
}
