const scc: (graph: number[][]) => {
  components: number[][];
  adjacencyList: number[][];
} = require("strongly-connected-components");

export interface Tree {
  components: Map<
    number,
    {
      keys: number[];
      dependencies: number[];
    }
  >;
  rootComponents: number[];
}

export interface Graph {
  nodes: { key: number; isRoot?: boolean }[];
  links: { source: number; target: number }[];
}

export function convertGraphToTree(graph: Graph): Tree {
  const nodeToIndex = new Map<number, number>();
  const indexToNode = new Map<number, number>();
  const indexToRoot = new Map<number, boolean>();
  graph.nodes.forEach((n, i) => nodeToIndex.set(n.key, i));
  graph.nodes.forEach((n, i) => indexToNode.set(i, n.key));
  graph.nodes.forEach((n, i) => indexToRoot.set(i, n.isRoot || false));

  const gr: number[][] = graph.nodes.map(() => []);
  graph.links.forEach((link) => {
    const targetIndex = nodeToIndex.get(link.target)!;
    const sourceTarget = nodeToIndex.get(link.source)!;
    gr[sourceTarget].push(targetIndex);
  });
  const { components, adjacencyList } = scc(gr);
  const tree: Tree = { components: new Map(), rootComponents: [] };
  components.forEach((c, j) => {
    const keys = c.map((j) => indexToNode.get(j)!);
    const isRoot = c.find((j) => indexToRoot.get(j)) !== undefined;
    if (isRoot) {
      tree.rootComponents.push(j);
    }
    tree.components.set(j, {
      keys,
      dependencies: [],
    });
  });
  adjacencyList.forEach((c, i) => {
    tree.components.get(i)!.dependencies.push(...c);
  });
  return tree;
}
