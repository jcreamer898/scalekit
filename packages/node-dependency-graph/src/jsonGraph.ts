import { Graph, Node } from "./graph";

export interface JsonNode {
  id: number;
  isLocal?: boolean;
  name: string;
  version: string;
  missing?: string[];
  resolvedPeerDependencies?: { [name: string]: number };
}
export interface JsonLink {
  sourceId: number;
  targetId: number;
}

export interface JsonGraph {
  nodes: JsonNode[];
  links: JsonLink[];
}

export function makeJsonGraph(graph: Graph): JsonGraph {
  function getReachableNodes(graph: Graph) {
    const reached = new Set<Node>();

    const rootIds: Node[] = graph.all().filter((i) => i.isLocal);

    const waiting = [...rootIds];
    while (waiting.length > 0) {
      const next = waiting.pop();
      if (next === undefined || reached.has(next)) {
        continue;
      }
      reached.add(next);
      const deps = graph.getChildren(next);
      waiting.push(...deps);
    }
    return reached;
  }
  const reachableNodes = getReachableNodes(graph);
  const result: {
    internalId: Node;
    name: string;
    version: string;
    missing?: string[];
  }[] = graph
    .all()
    .map((id) => {
      const { name, version, missing } = id;
      const node: {
        internalId: Node;
        name: string;
        version: string;
        missing?: string[];
      } = { internalId: id, name, version, missing };
      node.missing = missing.filter((m, i, a) => a.indexOf(m) === i);
      if (node.missing.length === 0) {
        delete node.missing;
      }
      return node;
    })
    .filter((o) => reachableNodes.has(o.internalId));
  const sortedNodes = result.sort((a, b) => {
    if (a.name > b.name) {
      return 1;
    }
    if (a.name < b.name) {
      return -1;
    }
    if (a.version > b.version) {
      return 1;
    }
    if (a.version < b.version) {
      return -1;
    }
    return 0;
  });
  const idMapping = new Map<Node, number>();
  sortedNodes.forEach((n, i) => {
    idMapping.set(n.internalId, i);
  });

  const nodes = sortedNodes.map((n) => {
    const o: { id: number; name: string; version: string; missing?: string[] } =
      {
        name: n.name,
        version: n.version,
        id: idMapping.get(n.internalId)!,
      };
    if (n.missing) {
      o.missing = n.missing;
    }
    return o;
  });

  const links: { sourceId: number; targetId: number }[] = [];
  [...reachableNodes].forEach((sourceId) => {
    graph.getChildren(sourceId).forEach((targetId) => {
      links.push({
        sourceId: idMapping.get(sourceId)!,
        targetId: idMapping.get(targetId)!,
      });
    });
  });
  links.sort((a, b) => {
    if (a.sourceId > b.sourceId) {
      return 1;
    }
    if (a.sourceId < b.sourceId) {
      return -1;
    }
    if (a.targetId > b.targetId) {
      return 1;
    }
    if (a.targetId < b.targetId) {
      return -1;
    }
    return 0;
  });
  return { nodes, links };
}
