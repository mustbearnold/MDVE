import {
  addEdge,
  addNode,
  clearLayoutPositions,
  deleteEdge,
  deleteNode,
  edgePositionKey,
  readEdgeLabelPositions,
  readNodePositions,
  renameNodeId,
  setDirection,
  setEdgeArrow,
  setEdgeLabel,
  setEdgeLabelPosition,
  setNodeLabel,
  setNodePosition,
  setNodeShape,
} from './mutate';
import {
  Diagram,
  ShapeName,
  parseDiagram,
  supportsStructuredEditing,
} from './parse';

export interface ModelPoint {
  x: number;
  y: number;
}

export interface SemanticNode {
  id: string;
  label: string;
  shape: ShapeName;
  position: ModelPoint;
  defined: boolean;
  sourceLines: number[];
}

export interface SemanticEdge {
  id: string;
  sourceKey: string;
  from: string;
  to: string;
  arrow: string;
  label?: string;
  position?: ModelPoint;
  sourceLine: number;
}

/**
 * The typed graph used by structured editing. Mermaid remains the durable
 * source and opaque lines stay outside this model; this object is the shared
 * semantic boundary for canvas, outline, inspector, and agent changes.
 */
export interface SemanticDiagram {
  source: string;
  parsed: Diagram;
  direction: string;
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  capabilities: {
    structuredEditing: boolean;
    preservesOpaqueSource: boolean;
  };
}

export type DiagramOperation =
  | { kind: 'node.set-label'; nodeId: string; label: string }
  | { kind: 'node.set-shape'; nodeId: string; shape: ShapeName }
  | { kind: 'node.rename'; nodeId: string; nextId: string }
  | { kind: 'node.add'; id?: string; label?: string; shape?: ShapeName }
  | { kind: 'node.delete'; nodeId: string }
  | { kind: 'edge.add'; from: string; to: string; arrow?: string; label?: string }
  | { kind: 'edge.set-label'; edgeId: string; label: string }
  | { kind: 'edge.set-arrow'; edgeId: string; arrow: string }
  | { kind: 'edge.delete'; edgeId: string }
  | { kind: 'layout.move'; nodeId: string; position: ModelPoint }
  | { kind: 'layout.move-many'; positions: Record<string, ModelPoint> }
  | { kind: 'layout.edge-label'; edgeId: string; position: ModelPoint }
  | { kind: 'layout.align'; nodeIds: string[]; axis: 'x' | 'y' }
  | { kind: 'layout.distribute'; nodeIds: string[]; axis: 'x' | 'y' }
  | { kind: 'layout.reset' }
  | { kind: 'diagram.set-direction'; direction: string };

export type TransactionOrigin = 'user' | 'agent' | 'system';

export interface DiagramTransaction {
  id: string;
  title: string;
  origin: TransactionOrigin;
  operations: DiagramOperation[];
  before: string;
  after: string;
  affectedNodes: string[];
  affectedEdges: string[];
}

export interface TransactionRequest {
  id?: string;
  title: string;
  origin?: TransactionOrigin;
  operations: DiagramOperation[];
}

export interface AppliedTransaction {
  source: string;
  model: SemanticDiagram;
  transaction: DiagramTransaction;
  changed: boolean;
}

export class DiagramModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramModelError';
  }
}

function copyPoint(point: ModelPoint): ModelPoint {
  return { x: point.x, y: point.y };
}

function finitePoint(point: ModelPoint): ModelPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new DiagramModelError('A layout position must contain finite x and y values');
  }
  return copyPoint(point);
}

function edgeIdFor(diagram: Diagram, edge: Diagram['edges'][number]): string {
  return edgePositionKey(diagram, edge);
}

export function buildSemanticDiagram(source: string, renderError?: string | null): SemanticDiagram {
  const parsed = parseDiagram(source);
  const nodePositions = readNodePositions(source);
  const edgePositions = readEdgeLabelPositions(source);

  return {
    source,
    parsed,
    direction: parsed.direction,
    nodes: parsed.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      shape: node.shape,
      position: copyPoint(nodePositions.get(node.id) ?? { x: 0, y: 0 }),
      defined: node.defined,
      sourceLines: [...node.lines],
    })),
    edges: parsed.edges.map((edge) => ({
      id: edgeIdFor(parsed, edge),
      sourceKey: edge.key,
      from: edge.from,
      to: edge.to,
      arrow: edge.arrow,
      label: edge.label,
      position: edgePositions.get(edgeIdFor(parsed, edge))
        ? copyPoint(edgePositions.get(edgeIdFor(parsed, edge))!)
        : undefined,
      sourceLine: edge.line,
    })),
    capabilities: {
      structuredEditing: supportsStructuredEditing(parsed, renderError),
      preservesOpaqueSource: true,
    },
  };
}

function requireStructured(model: SemanticDiagram): void {
  if (!model.capabilities.structuredEditing) {
    throw new DiagramModelError('This Diagram is source-only; structured editing requires a valid flowchart or graph');
  }
}

function requireNode(model: SemanticDiagram, nodeId: string): SemanticNode {
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new DiagramModelError(`Unknown node: ${nodeId}`);
  return node;
}

function requireEdge(model: SemanticDiagram, edgeId: string): SemanticEdge {
  const edge = model.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) throw new DiagramModelError(`Unknown link: ${edgeId}`);
  return edge;
}

function positionFor(model: SemanticDiagram, nodeId: string): ModelPoint {
  return copyPoint(requireNode(model, nodeId).position);
}

function applyOperation(source: string, operation: DiagramOperation): { source: string; affectedNodes: string[]; affectedEdges: string[] } {
  let model = buildSemanticDiagram(source);
  requireStructured(model);
  const affectedNodes = new Set<string>();
  const affectedEdges = new Set<string>();
  let next = source;

  switch (operation.kind) {
    case 'node.set-label':
      requireNode(model, operation.nodeId);
      next = setNodeLabel(source, operation.nodeId, operation.label);
      affectedNodes.add(operation.nodeId);
      break;
    case 'node.set-shape':
      requireNode(model, operation.nodeId);
      next = setNodeShape(source, operation.nodeId, operation.shape);
      affectedNodes.add(operation.nodeId);
      break;
    case 'node.rename':
      requireNode(model, operation.nodeId);
      next = renameNodeId(source, operation.nodeId, operation.nextId);
      affectedNodes.add(operation.nodeId);
      affectedNodes.add(operation.nextId);
      break;
    case 'node.add': {
      const result = addNode(source, { id: operation.id, label: operation.label, shape: operation.shape });
      next = result.source;
      if (result.id) affectedNodes.add(result.id);
      break;
    }
    case 'node.delete':
      requireNode(model, operation.nodeId);
      model.edges.forEach((edge) => {
        if (edge.from === operation.nodeId || edge.to === operation.nodeId) affectedEdges.add(edge.id);
      });
      next = deleteNode(source, operation.nodeId);
      affectedNodes.add(operation.nodeId);
      break;
    case 'edge.add':
      requireNode(model, operation.from);
      requireNode(model, operation.to);
      next = addEdge(source, operation.from, operation.to, { arrow: operation.arrow, label: operation.label });
      affectedNodes.add(operation.from);
      affectedNodes.add(operation.to);
      break;
    case 'edge.set-label': {
      const edge = requireEdge(model, operation.edgeId);
      next = setEdgeLabel(source, edge.sourceKey, operation.label);
      affectedEdges.add(edge.id);
      break;
    }
    case 'edge.set-arrow': {
      const edge = requireEdge(model, operation.edgeId);
      next = setEdgeArrow(source, edge.sourceKey, operation.arrow);
      affectedEdges.add(edge.id);
      break;
    }
    case 'edge.delete': {
      const edge = requireEdge(model, operation.edgeId);
      next = deleteEdge(source, edge.sourceKey);
      affectedEdges.add(edge.id);
      break;
    }
    case 'layout.move':
      requireNode(model, operation.nodeId);
      next = setNodePosition(source, operation.nodeId, finitePoint(operation.position));
      affectedNodes.add(operation.nodeId);
      break;
    case 'layout.move-many':
      for (const [nodeId, point] of Object.entries(operation.positions)) {
        requireNode(model, nodeId);
        next = setNodePosition(next, nodeId, finitePoint(point));
        affectedNodes.add(nodeId);
      }
      break;
    case 'layout.edge-label': {
      const edge = requireEdge(model, operation.edgeId);
      next = setEdgeLabelPosition(source, edge.sourceKey, finitePoint(operation.position));
      affectedEdges.add(edge.id);
      break;
    }
    case 'layout.align': {
      const ids = [...new Set(operation.nodeIds)];
      if (ids.length < 2) return { source, affectedNodes: [], affectedEdges: [] };
      ids.forEach((nodeId) => requireNode(model, nodeId));
      const value = positionFor(model, ids[0])[operation.axis];
      const positions: Record<string, ModelPoint> = {};
      ids.forEach((nodeId) => {
        const point = positionFor(model, nodeId);
        positions[nodeId] = operation.axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
      });
      return applyOperation(source, { kind: 'layout.move-many', positions });
    }
    case 'layout.distribute': {
      const ids = [...new Set(operation.nodeIds)];
      if (ids.length < 3) return { source, affectedNodes: [], affectedEdges: [] };
      ids.forEach((nodeId) => requireNode(model, nodeId));
      const sorted = ids
        .map((nodeId) => ({ nodeId, point: positionFor(model, nodeId) }))
        .sort((left, right) => left.point[operation.axis] - right.point[operation.axis]);
      const first = sorted[0].point[operation.axis];
      const last = sorted[sorted.length - 1].point[operation.axis];
      const step = (last - first) / (sorted.length - 1);
      const positions: Record<string, ModelPoint> = {};
      sorted.forEach(({ nodeId, point }, index) => {
        const value = first + step * index;
        positions[nodeId] = operation.axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
      });
      return applyOperation(source, { kind: 'layout.move-many', positions });
    }
    case 'layout.reset':
      next = clearLayoutPositions(source);
      model.nodes.forEach((node) => affectedNodes.add(node.id));
      model.edges.filter((edge) => edge.position).forEach((edge) => affectedEdges.add(edge.id));
      break;
    case 'diagram.set-direction':
      next = setDirection(source, operation.direction);
      break;
  }

  return { source: next, affectedNodes: [...affectedNodes], affectedEdges: [...affectedEdges] };
}

function transactionId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function applyDiagramTransaction(source: string, request: TransactionRequest): AppliedTransaction {
  let next = source;
  const affectedNodes = new Set<string>();
  const affectedEdges = new Set<string>();

  try {
    for (const operation of request.operations) {
      const result = applyOperation(next, operation);
      next = result.source;
      result.affectedNodes.forEach((id) => affectedNodes.add(id));
      result.affectedEdges.forEach((id) => affectedEdges.add(id));
    }
  } catch (error) {
    if (error instanceof DiagramModelError) throw error;
    throw new DiagramModelError(error instanceof Error ? error.message : String(error));
  }

  const transaction: DiagramTransaction = {
    id: request.id ?? transactionId(),
    title: request.title,
    origin: request.origin ?? 'user',
    operations: [...request.operations],
    before: source,
    after: next,
    affectedNodes: [...affectedNodes].sort(),
    affectedEdges: [...affectedEdges].sort(),
  };

  return { source: next, model: buildSemanticDiagram(next), transaction, changed: next !== source };
}

export interface SemanticDelta {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  changedEdges: string[];
  movedNodes: string[];
}

/** Produces a user-facing summary for an agent proposal without diffing text. */
export function compareSemanticDiagrams(before: string, after: string): SemanticDelta {
  const left = buildSemanticDiagram(before);
  const right = buildSemanticDiagram(after);
  const leftNodes = new Map(left.nodes.map((node) => [node.id, node]));
  const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
  const leftEdges = new Map(left.edges.map((edge) => [edge.id, edge]));
  const rightEdges = new Map(right.edges.map((edge) => [edge.id, edge]));

  const addedNodes = [...rightNodes.keys()].filter((id) => !leftNodes.has(id)).sort();
  const removedNodes = [...leftNodes.keys()].filter((id) => !rightNodes.has(id)).sort();
  const changedNodes = [...rightNodes.keys()]
    .filter((id) => {
      const leftNode = leftNodes.get(id);
      const rightNode = rightNodes.get(id)!;
      return leftNode && (leftNode.label !== rightNode.label || leftNode.shape !== rightNode.shape);
    })
    .sort();
  const movedNodes = [...rightNodes.keys()]
    .filter((id) => {
      const leftNode = leftNodes.get(id);
      const rightNode = rightNodes.get(id)!;
      return leftNode && (leftNode.position.x !== rightNode.position.x || leftNode.position.y !== rightNode.position.y);
    })
    .sort();
  const addedEdges = [...rightEdges.keys()].filter((id) => !leftEdges.has(id)).sort();
  const removedEdges = [...leftEdges.keys()].filter((id) => !rightEdges.has(id)).sort();
  const changedEdges = [...rightEdges.keys()]
    .filter((id) => {
      const leftEdge = leftEdges.get(id);
      const rightEdge = rightEdges.get(id)!;
      return leftEdge && (leftEdge.arrow !== rightEdge.arrow || leftEdge.label !== rightEdge.label);
    })
    .sort();

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, changedEdges, movedNodes };
}
