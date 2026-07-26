/**
 * A small, forgiving parser for the flowchart subset of Mermaid.
 *
 * It is deliberately line-oriented: every source line is turned into either a
 * structured statement (a chain of node tokens joined by links) or an opaque
 * "raw" line that is preserved verbatim. That lets the visual editor rewrite
 * only the lines it touches and leave everything else — comments, classDefs,
 * unsupported syntax — exactly as the user wrote it.
 */

export type ShapeName =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'asymmetric'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'parallelogram-alt'
  | 'trapezoid'
  | 'trapezoid-alt';

export interface ShapeSpec {
  name: ShapeName;
  open: string;
  close: string;
  label: string;
}

/** Order matters: longer openers are tried first. */
export const SHAPES: ShapeSpec[] = [
  { name: 'subroutine', open: '[[', close: ']]', label: 'Subroutine' },
  { name: 'cylinder', open: '[(', close: ')]', label: 'Database' },
  { name: 'circle', open: '((', close: '))', label: 'Circle' },
  { name: 'stadium', open: '([', close: '])', label: 'Stadium' },
  { name: 'hexagon', open: '{{', close: '}}', label: 'Hexagon' },
  { name: 'trapezoid', open: '[/', close: '\\]', label: 'Trapezoid' },
  { name: 'parallelogram', open: '[/', close: '/]', label: 'Parallelogram' },
  { name: 'trapezoid-alt', open: '[\\', close: '/]', label: 'Trapezoid alt' },
  { name: 'parallelogram-alt', open: '[\\', close: '\\]', label: 'Parallelogram alt' },
  { name: 'rect', open: '[', close: ']', label: 'Rectangle' },
  { name: 'round', open: '(', close: ')', label: 'Rounded' },
  { name: 'diamond', open: '{', close: '}', label: 'Diamond' },
  { name: 'asymmetric', open: '>', close: ']', label: 'Flag' },
];

const SHAPE_BY_NAME = new Map(SHAPES.map((s) => [s.name, s]));

export interface NodeToken {
  kind: 'node';
  id: string;
  /** Undefined when the token is a bare id reference such as `A --> B`. */
  label?: string;
  shape?: ShapeName;
  /** True when the label was written inside double quotes. */
  quoted?: boolean;
}

export interface LinkToken {
  kind: 'link';
  /** Raw arrow text, e.g. `-->`, `-.->`, `==>`, `---`. */
  arrow: string;
  label?: string;
  /** `pipe` for `-->|text|`, `mid` for `-- text -->`. */
  labelStyle?: 'pipe' | 'mid';
}

export type Token = NodeToken | LinkToken;

export interface StatementLine {
  kind: 'statement';
  index: number;
  indent: string;
  tokens: Token[];
  /** Trailing `%% comment` or `;`, preserved as written. */
  trailing: string;
  raw: string;
}

export interface RawLine {
  kind: 'raw';
  index: number;
  raw: string;
}

export type Line = StatementLine | RawLine;

export interface DiagramNode {
  id: string;
  label: string;
  shape: ShapeName;
  /** Lines on which this node appears. */
  lines: number[];
  /** True when at least one occurrence carries an explicit label. */
  defined: boolean;
}

export interface DiagramEdge {
  /** Stable-enough identity: line index + position within the line. */
  key: string;
  from: string;
  to: string;
  arrow: string;
  label?: string;
  line: number;
  /** Index of the link token within its statement line. */
  tokenIndex: number;
}

export interface Diagram {
  /** `flowchart` or `graph`; undefined when the header is missing/unsupported. */
  header?: string;
  direction: string;
  headerLine: number;
  lines: Line[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** True when the source declares a diagram type this editor cannot model. */
  unsupported: boolean;
}

const HEADER_RE = /^\s*(flowchart|graph)\s+(TB|TD|BT|RL|LR)?\s*$/i;
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*/;

/** Arrow forms, longest first so `-->` is not read as `--`. */
const ARROW_RES: RegExp[] = [
  /^<-{2,}>/, // <-->
  /^<=+>/, // <==>
  /^<-\.-+>/, // <-.->
  /^-\.-*->/, // -.->  -.-->
  /^-\.-+/, // -.-
  /^=+>/, // ==>
  /^={2,}/, // ===
  /^-{2,}[ox]/, // --o --x
  /^={2,}[ox]/, // ==o ==x
  /^-{2,}>/, // -->
  /^-{2,}/, // ---
  /^~{3,}/, // ~~~
  /^--[ox]/,
];

function matchArrow(s: string): string | null {
  for (const re of ARROW_RES) {
    const m = re.exec(s);
    if (m) return m[0];
  }
  return null;
}

/** Reads a `"quoted"` or bare label terminated by `close`. */
function readLabel(s: string, from: number, close: string): { label: string; end: number; quoted: boolean } | null {
  if (s[from] === '"') {
    const end = s.indexOf('"', from + 1);
    if (end === -1) return null;
    if (!s.startsWith(close, end + 1)) return null;
    return { label: s.slice(from + 1, end), end: end + 1 + close.length, quoted: true };
  }
  const end = s.indexOf(close, from);
  if (end === -1) return null;
  return { label: s.slice(from, end), end: end + close.length, quoted: false };
}

/**
 * Reads a node token at `pos`. Returns null when the text there is not a node.
 */
function readNode(s: string, pos: number): { token: NodeToken; end: number } | null {
  const idMatch = ID_RE.exec(s.slice(pos));
  if (!idMatch) return null;
  const id = idMatch[0];
  let cursor = pos + id.length;

  for (const shape of SHAPES) {
    if (!s.startsWith(shape.open, cursor)) continue;
    // `[/` and `[\` are ambiguous: whichever closer appears first wins, and the
    // SHAPES ordering above enumerates both possibilities per opener.
    const read = readLabel(s, cursor + shape.open.length, shape.close);
    if (!read) continue;
    return {
      token: { kind: 'node', id, label: read.label, shape: shape.name, quoted: read.quoted },
      end: read.end,
    };
  }
  return { token: { kind: 'node', id }, end: cursor };
}

/**
 * Parses a single line into a statement, or returns null when the line is not a
 * node/link chain (comments, subgraph, classDef, style, click, …).
 */
function parseStatement(raw: string, index: number): StatementLine | null {
  const indentMatch = /^\s*/.exec(raw)!;
  const indent = indentMatch[0];
  const body = raw.slice(indent.length);
  if (!body || body.startsWith('%%')) return null;

  // Strip a trailing `;` plus any trailing comment; both are preserved.
  let content = body;
  let trailing = '';
  const commentAt = content.indexOf('%%');
  if (commentAt !== -1) {
    trailing = content.slice(commentAt);
    content = content.slice(0, commentAt);
  }
  const trimmedRight = content.replace(/\s+$/, '');
  if (trimmedRight.endsWith(';')) {
    trailing = ';' + (trailing ? ' ' + trailing : '');
    content = trimmedRight.slice(0, -1);
  }

  const keyword = /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i;
  if (keyword.test(content.trim())) return null;

  const tokens: Token[] = [];
  let pos = 0;
  const skipWs = () => {
    while (pos < content.length && /\s/.test(content[pos])) pos++;
  };

  skipWs();
  const first = readNode(content, pos);
  if (!first) return null;
  tokens.push(first.token);
  pos = first.end;

  while (pos < content.length) {
    skipWs();
    if (pos >= content.length) break;

    const arrow = matchArrow(content.slice(pos));
    if (!arrow) return null; // Unrecognised syntax — keep the line opaque.
    pos += arrow.length;

    let label: string | undefined;
    let labelStyle: LinkToken['labelStyle'];

    if (content[pos] === '|') {
      const end = content.indexOf('|', pos + 1);
      if (end === -1) return null;
      label = content.slice(pos + 1, end).replace(/^"|"$/g, '');
      labelStyle = 'pipe';
      pos = end + 1;
    } else {
      // Mid-arrow label form: `A -- text --> B`.
      const rest = content.slice(pos);
      const mid = /^\s*([^->=|\n]+?)\s*(-{2,}>|-{2,}|={2,}>|={2,}|\.-+>|-\.-+>)/.exec(rest);
      if (mid && !/^\s*$/.test(mid[1])) {
        label = mid[1].trim();
        labelStyle = 'mid';
        pos += mid[0].length;
      }
    }

    tokens.push({ kind: 'link', arrow, label, labelStyle });
    skipWs();
    const next = readNode(content, pos);
    if (!next) return null;
    tokens.push(next.token);
    pos = next.end;
  }

  if (tokens.length === 0) return null;
  return { kind: 'statement', index, indent, tokens, trailing, raw };
}

export function serializeNodeToken(t: NodeToken): string {
  if (t.label === undefined || t.shape === undefined) return t.id;
  const shape = SHAPE_BY_NAME.get(t.shape)!;
  const needsQuotes = t.quoted || /["'`{}()\[\]<>|]/.test(t.label);
  const label = needsQuotes ? `"${t.label.replace(/"/g, "'")}"` : t.label;
  return `${t.id}${shape.open}${label}${shape.close}`;
}

export function serializeLinkToken(t: LinkToken): string {
  if (t.label === undefined || t.label === '') return t.arrow;
  if (t.labelStyle === 'mid') {
    // Reduce mid-form to the pipe form; it round-trips more reliably.
    return `${t.arrow}|${t.label}|`;
  }
  return `${t.arrow}|${t.label}|`;
}

export function serializeStatement(line: StatementLine): string {
  const parts = line.tokens.map((t) =>
    t.kind === 'node' ? serializeNodeToken(t) : serializeLinkToken(t),
  );
  const body = parts.join(' ');
  const trailing = line.trailing ? (line.trailing.startsWith(';') ? line.trailing : ' ' + line.trailing) : '';
  return `${line.indent}${body}${trailing}`;
}

export function parseDiagram(source: string): Diagram {
  const rawLines = source.split('\n');
  const lines: Line[] = [];
  let header: string | undefined;
  let direction = 'TD';
  let headerLine = -1;
  let unsupported = false;

  rawLines.forEach((raw, index) => {
    if (headerLine === -1) {
      const m = HEADER_RE.exec(raw);
      if (m) {
        header = m[1].toLowerCase();
        direction = (m[2] || 'TD').toUpperCase();
        headerLine = index;
        lines.push({ kind: 'raw', index, raw });
        return;
      }
      const other = /^\s*(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|C4Context|sankey-beta|xychart-beta|block-beta)\b/.exec(
        raw,
      );
      if (other) {
        unsupported = true;
        headerLine = index;
        header = other[1];
        lines.push({ kind: 'raw', index, raw });
        return;
      }
    }

    if (unsupported) {
      lines.push({ kind: 'raw', index, raw });
      return;
    }

    const stmt = parseStatement(raw, index);
    lines.push(stmt ?? { kind: 'raw', index, raw });
  });

  const nodeMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  for (const line of lines) {
    if (line.kind !== 'statement') continue;
    line.tokens.forEach((token, i) => {
      if (token.kind === 'node') {
        const existing = nodeMap.get(token.id);
        if (existing) {
          existing.lines.push(line.index);
          if (token.label !== undefined) {
            if (!existing.defined) {
              existing.label = token.label;
              existing.shape = token.shape ?? 'rect';
              existing.defined = true;
            }
          }
        } else {
          nodeMap.set(token.id, {
            id: token.id,
            label: token.label ?? token.id,
            shape: token.shape ?? 'rect',
            lines: [line.index],
            defined: token.label !== undefined,
          });
        }
      } else {
        const from = line.tokens[i - 1];
        const to = line.tokens[i + 1];
        if (from?.kind === 'node' && to?.kind === 'node') {
          edges.push({
            key: `${line.index}:${i}`,
            from: from.id,
            to: to.id,
            arrow: token.arrow,
            label: token.label,
            line: line.index,
            tokenIndex: i,
          });
        }
      }
    });
  }

  return {
    header,
    direction,
    headerLine,
    lines,
    nodes: [...nodeMap.values()],
    edges,
    unsupported,
  };
}

/** Rebuilds source text from a (possibly mutated) line list. */
export function serializeDiagram(lines: Line[]): string {
  return lines
    .map((line) => (line.kind === 'statement' ? serializeStatement(line) : line.raw))
    .join('\n');
}

export function shapeLabel(name: ShapeName): string {
  return SHAPE_BY_NAME.get(name)?.label ?? name;
}
