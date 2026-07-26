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
  parseDiagram,
  serializeDiagram,
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

/** Where new statements should be appended (after the last statement, else end). */
function insertionIndex(lines: Line[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind === 'statement') return i + 1;
  }
  return lines.length;
}

function defaultIndent(lines: Line[]): string {
  const first = statements(lines)[0];
  if (first) return first.indent;
  return '  ';
}

function reindex(lines: Line[]): Line[] {
  return lines.map((line, index) => ({ ...line, index }));
}

export function setNodeLabel(source: string, id: string, label: string): string {
  const diagram = parseDiagram(source);
  const lines = cloneLines(diagram);
  let applied = false;

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind !== 'node' || token.id !== id) continue;
      if (token.label !== undefined) {
        token.label = label;
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
  const lines = cloneLines(diagram);
  const node = diagram.nodes.find((n) => n.id === id);
  const label = node?.label ?? id;
  let applied = false;

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind !== 'node' || token.id !== id) continue;
      if (token.label !== undefined) {
        token.shape = shape;
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
  const diagram = parseDiagram(source);
  if (diagram.nodes.some((n) => n.id === newId)) return source;
  const lines = cloneLines(diagram);

  for (const line of statements(lines)) {
    for (const token of line.tokens) {
      if (token.kind === 'node' && token.id === oldId) token.id = newId;
    }
  }
  return serializeDiagram(lines);
}

export function addNode(
  source: string,
  opts: { id?: string; label?: string; shape?: ShapeName } = {},
): { source: string; id: string } {
  const diagram = parseDiagram(source);
  const existing = new Set(diagram.nodes.map((n) => n.id));
  let id = opts.id;
  if (!id || existing.has(id)) {
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
    indent: defaultIndent(lines),
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
  const lines = cloneLines(diagram);
  const at = insertionIndex(lines);
  lines.splice(at, 0, {
    kind: 'statement',
    index: at,
    indent: defaultIndent(lines),
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
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;
  const token = line.tokens[tokenIndex];
  if (!token || token.kind !== 'link') return source;
  token.label = label || undefined;
  token.labelStyle = 'pipe';
  return serializeDiagram(lines);
}

export function setEdgeArrow(source: string, key: string, arrow: string): string {
  const diagram = parseDiagram(source);
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;
  const token = line.tokens[tokenIndex];
  if (!token || token.kind !== 'link') return source;
  token.arrow = arrow;
  return serializeDiagram(lines);
}

/**
 * Removes one link from a chain. `A --> B --> C` minus the first link becomes
 * two statements so that no node silently loses its definition.
 */
export function deleteEdge(source: string, key: string): string {
  const diagram = parseDiagram(source);
  const lines = cloneLines(diagram);
  const [lineIndex, tokenIndex] = key.split(':').map(Number);
  const line = lines[lineIndex];
  if (!line || line.kind !== 'statement') return source;

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
  return serializeDiagram(reindex(lines));
}

/** Deletes a node and every link that touches it. */
export function deleteNode(source: string, id: string): string {
  const diagram = parseDiagram(source);
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

  return serializeDiagram(reindex(out));
}

export function setDirection(source: string, direction: string): string {
  const diagram = parseDiagram(source);
  if (diagram.headerLine === -1 || diagram.unsupported) return source;
  const lines = cloneLines(diagram);
  const header = lines[diagram.headerLine];
  const kind = diagram.header ?? 'flowchart';
  header.raw = header.raw.replace(
    /^(\s*)(flowchart|graph)\s+\w*\s*$/i,
    (_m, indent: string) => `${indent}${kind} ${direction}`,
  );
  return serializeDiagram(lines);
}
