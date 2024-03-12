/**
 * Graph node
 */
export interface Node {
  /**
   * Unique key for a node.
   */
  key: number;
  /**
   * Name of the node.
   */
  name: string;
  /**
   * Version of the node.
   */
  version?: string;
  /**
   * Use the package in place, do not copy it to the store.
   */
  keepInPlace?: boolean;
  /**
   * List of the bins provided by this package.
   */
  bins?: { [key: string]: string };
  /**
   * Absolute path to a folder where the content of this node is stored.
   */
  location: string;

  files?: Map<string, { offset: number; size: number; mode: number }>;

  buffer?: SharedArrayBuffer;
  /**
   * Absolute path to a folder where the content of this node is copied to on disk.
   */
  destination?: string;
}

/**
 * Dependency graph.
 */
export interface Graph {
  /**
   * Nodes of the graph.
   */
  nodes: Node[];
  /**
   * Links between nodes.
   */
  links: {
    /**
     * Unique key of the source node.
     */
    source: number;
    /**
     * Unique key of the target node.
     */
    target: number;
  }[];
}
