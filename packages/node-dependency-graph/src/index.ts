import { Graph, PeerLink, Node } from "./graph";
import { makeJsonGraph, JsonGraph } from "./jsonGraph";
import * as semver from "semver";
import chalk from "chalk";
/*
 * This is a queue which also maintain an index
 * to allow for quick random access
 */
class UnresolvedPeerDeps {
  queue: PeerLink[];
  parentsBySourceAndTarget: Map<Node, Map<string, Set<Node>>>;

  constructor(list: PeerLink[]) {
    this.queue = [];
    this.parentsBySourceAndTarget = new Map();
    list.forEach(this.push.bind(this));
  }

  push(peerDep: PeerLink): void {
    this.queue.push(peerDep);
    if (!this.parentsBySourceAndTarget.has(peerDep.source)) {
      this.parentsBySourceAndTarget.set(peerDep.source, new Map());
    }
    if (
      !this.parentsBySourceAndTarget
        .get(peerDep.source)!
        .has(peerDep.targetName)
    ) {
      this.parentsBySourceAndTarget
        .get(peerDep.source)!
        .set(peerDep.targetName, new Set());
    }
    this.parentsBySourceAndTarget
      .get(peerDep.source)!
      .get(peerDep.targetName)!
      .add(peerDep.parent);
  }
  get length(): number {
    return this.queue.length;
  }
  shift(): PeerLink | undefined {
    const result = this.queue.shift();
    if (!result) {
      return undefined;
    }
    this.parentsBySourceAndTarget
      .get(result.source)!
      .get(result.targetName)!
      .delete(result.parent);
    return result;
  }
  hasWithSourceAndTarget(source: Node, target: string): boolean {
    return (
      (this.parentsBySourceAndTarget.get(source)?.get(target)?.size || 0) !== 0
    );
  }
}

/**
 * Description of a package.
 */
export interface PackageManifest {
  name: string;
  version: string;
  /**
   * Local packages are packages which are located in the repository and should not be
   * copied to another location or duplicated.
   */
  isLocal?: boolean;
  dependencies?: { [name: string]: string };
  devDependencies?: { [name: string]: string };
  optionalDependencies?: { [name: string]: string };
  peerDependencies?: { [name: string]: string };
  peerDependenciesMeta?: { [name: string]: { optional?: boolean } };
  location?: string;
}

export interface Missing {
  id: number;
  missing?: string[];
  name: string;
  version: string;
  parentName: string;
  parentVersion: string;
}

interface ResolutionMap {
  [name: string]: { [range: string]: string };
}

/**
 * A peer dependency will resolve to a nodeId when successful
 */
type ChildResolution =
  | { state: "success"; node: Node }
  | { state: "failed" | "ignored" | "retryLater" };

/*
 * This compares strings in a culture independent way so that the
 * result does not depend on the machine's locale.
 * The comparisons operators ">" and "<" are culture independent.
 **/
function localeIndependentCompare(s1: string, s2: string): number {
  if (s1 > s2) {
    return 1;
  }
  if (s2 > s1) {
    return -1;
  }
  return 0;
}

/**
 * Creates a Graph using package.json manifests
 * @param manifests
 * @param resolutionMap
 * @param failOnMissingPeerDependencies
 * @returns
 */
export const createGraph = (
  manifests: PackageManifest[],
  resolutionMap: ResolutionMap,
  failOnMissingPeerDependencies?: boolean,
  logger = console
): Graph => {
  if (failOnMissingPeerDependencies === undefined) {
    failOnMissingPeerDependencies = true;
  }

  const graph = new Graph();

  // Create deterministic graph
  // TODO: make the resolution algorithm insensitive to order instead
  manifests = manifests.sort((o1, o2) => {
    const nameComparison = localeIndependentCompare(o1.name, o2.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return localeIndependentCompare(o1.version, o2.version);
  });

  // Adding nodes to the graph
  manifests.forEach((m) => {
    graph.addNode(m.name, m.version, m.isLocal || false);
  });

  // Adding dependencies to the graph
  manifests.forEach((m) => {
    const source = graph.getNodeWithoutPeerDependencies(m.name, m.version)!;

    const dependencies = m.dependencies;
    if (dependencies) {
      Object.keys(dependencies).forEach((k) => {
        const targetName = k;
        const targetRange = dependencies[k];
        const targetVersion = resolutionMap[targetName][targetRange];
        const target = graph.getNodeWithoutPeerDependencies(
          targetName,
          targetVersion
        )!;
        if (typeof target === "undefined" || typeof source === "undefined") {
          logger.info(
            `❗ Found issues in graph, run with LOG_LEVEL=debug to see them.`
          );
          logger.debug(`Error in graph ${m.name}`);
          logger.debug(`Error in graph to ${targetName}`);
          logger.debug({ source, target });
        } else {
          graph.addLink(source, target);
        }
      });
    }
  });

  // Adding devDependencies to the graph
  manifests.forEach((m) => {
    if (!m.isLocal) {
      return;
    }

    const source = graph.getNodeWithoutPeerDependencies(m.name, m.version)!;

    const dependencies = m.devDependencies;
    if (dependencies) {
      Object.keys(dependencies).forEach((k) => {
        const targetName = k;
        const targetRange = dependencies[k];
        const targetVersion = resolutionMap[targetName][targetRange];
        const target = graph.getNodeWithoutPeerDependencies(
          targetName,
          targetVersion
        )!;

        // TODO: why is this happening?
        if (typeof target === "undefined" || typeof source === "undefined") {
          console.log(`Error linking ${m.name} to ${targetName}`);
          console.log({ source, target });
        } else {
          graph.addLink(source, target);
        }
      });
    }
  });

  manifests.forEach((m) => {
    const source = graph.getNodeWithoutPeerDependencies(m.name, m.version)!;

    const dependencies = m.optionalDependencies;
    if (dependencies) {
      Object.keys(dependencies).forEach((k) => {
        const targetName = k;
        const targetRange = dependencies[k];
        const targetVersion = resolutionMap[targetName][targetRange];
        const target = graph.getNodeWithoutPeerDependencies(
          targetName,
          targetVersion
        );
        if (!target) {
          // This is legal, it means the optional dependency is not installed.
          return;
        }
        graph.addLink(source, target);
      });
    }
  });

  manifests.forEach((m) => {
    if (m.isLocal) {
      return;
    }

    const source = graph.getNodeWithoutPeerDependencies(m.name, m.version)!;

    const dependencies = {
      ...(m.peerDependenciesMeta
        ? Object.keys(m.peerDependenciesMeta)
            .map((k) => ({ [k]: "*" }))
            .reduce((a, c) => ({ ...a, ...c }), {})
        : {}),
      ...(m.peerDependencies || {}),
    };
    if (dependencies) {
      Object.keys(dependencies).forEach((k) => {
        const targetName = k;
        const targetRange = dependencies[k];
        const optional = Boolean(
          m.peerDependenciesMeta &&
            m.peerDependenciesMeta[k] &&
            m.peerDependenciesMeta[k].optional
        );

        graph.addPeerLink(source, targetName, targetRange, optional);
      });
    }
  });

  // Resolve PeerLinks
  let peerDeps = new UnresolvedPeerDeps(graph.getPeerLinks());
  let watchDog = peerDeps.length + 1;
  while (peerDeps.length !== 0) {
    // Stop the loop when the number of elements in the queue are stable
    if (watchDog === 0) {
      break;
    }

    const peerDep = peerDeps.shift()!;
    const { parent, source, targetName, optional, targetRange } = peerDep;
    if (!graph.hasLink(parent, source)) {
      watchDog = peerDeps.length + 1;
      continue;
    }

    function resolveChild(name: string, optional: boolean): ChildResolution {
      const children = graph.getChildren(source);
      if (children.some((s) => s.name === name)) {
        return { state: "ignored" };
      }

      const siblings = graph.getChildren(parent);
      const candidates = siblings.concat([parent]);
      const result = candidates.filter((s) => s.name === name)[0];

      const parentName = parent.name;
      const parentVersion = parent.version;
      const sourceName = source.name;
      const sourceVersion = source.version;

      if (result !== undefined) {
        const version = result.version;

        if (!semver.satisfies(version, targetRange)) {
          console.debug(
            `❗ Unmatching peer dependency, ${chalk.yellowBright(
              name
            )} in ${chalk.yellowBright(sourceName)}@${chalk.yellowBright(
              sourceVersion
            )} (parent: ${parentName}@${parentVersion}) was resolved to version ${version} which does not satisfy the given range: ${targetRange}`
          );
        }

        // Install this peerDependency
        return { state: "success", node: result };
      } else {
        if (optional) {
          return { state: "ignored" };
        } else {
          source.missing = source.missing || [];
          if (!source.missing!.includes(name)) {
            source.missing!.push(name);
          }

          if (peerDeps.hasWithSourceAndTarget(parent, name)) {
            return { state: "retryLater" };
          } else {
            return { state: "failed" };
          }
        }
      }
    }

    const result = resolveChild(targetName, optional);

    if (result.state === "success") {
      const existingVirtualNode = graph.getVirtualNode(
        source,
        targetName,
        result.node
      );

      if (existingVirtualNode !== undefined) {
        const newPeerLinks = graph.getPeerLinksFor(existingVirtualNode);

        for (const newPeerLink of newPeerLinks) {
          peerDeps.push({
            parent,
            source: existingVirtualNode,
            targetName: newPeerLink.targetName,
            targetRange: newPeerLink.targetRange,
            optional: newPeerLink.optional,
          });
        }

        graph.changeChildren(parent, source, existingVirtualNode);

        watchDog = peerDeps.length + 1;
      } else {
        const newPackage = graph.createVirtualNode(
          source,
          targetName,
          result.node
        );

        const newPeerLinks = graph.getPeerLinksFor(newPackage);
        for (const newPeerLink of newPeerLinks) {
          peerDeps.push({
            parent,
            source: newPackage,
            targetName: newPeerLink.targetName,
            targetRange: newPeerLink.targetRange,
            optional: newPeerLink.optional,
          });
        }
        const children = graph.getChildren(newPackage);
        for (const child of children) {
          const childPeerLinks = graph.getPeerLinksFor(child);
          for (const childPeerLink of childPeerLinks) {
            peerDeps.push({
              parent: newPackage,
              source: child,
              targetName: childPeerLink.targetName,
              targetRange: childPeerLink.targetRange,
              optional: childPeerLink.optional,
            });
          }
        }
        graph.changeChildren(parent, source, newPackage);
        watchDog = peerDeps.length + 1;
      }
    } else if (result.state === "retryLater") {
      peerDeps.push(peerDep);
      watchDog--;
    }
  }

  return graph;
};

const sortString = (a: { name: string }, b: { name: string }) => {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();

  return aName < bName ? -1 : aName > bName ? 1 : 0;
};

const convertGraphToJson = (
  graph: Graph,
  {
    failOnMissingPeerDependencies = false,
    logger,
  }: { failOnMissingPeerDependencies?: boolean; logger: any }
): {
  graph: JsonGraph;
  missings: Missing[];
} => {
  const newGraph: JsonGraph = makeJsonGraph(graph);
  const unmetPeerMessages: Missing[] = [];

  const messages: string[] = [];
  const missings = newGraph.nodes.map((n) => ({
    id: n.id,
    missing: n.missing,
    name: n.name,
    version: n.version,
  }));

  for (const msg of missings) {
    if (!msg!.missing || msg!.missing!.length === 0) {
      continue;
    }
    const source = msg.name;
    const version = msg.version;
    const parents = newGraph.links
      .filter((l) => l.targetId === msg.id)
      .map((l) => l.sourceId);

    parents.forEach((parentId) => {
      const parent = newGraph.nodes.find((n) => n.id === parentId)!;
      const parentName = parent.name;
      const parentVersion = parent.version;

      for (const name of msg!.missing!) {
        messages.push(
          `Unmet peer dependency: ${chalk.yellowBright(
            `${parentName}@${parentVersion}`
          )} needs to provide ${chalk.yellowBright(
            name
          )} to ${chalk.yellowBright(`${msg.name}@${msg.version}`)}`
        );
      }

      const unmet = {
        id: msg.id,
        missing: msg.missing,
        name: source,
        version,
        parentName,
        parentVersion,
      };

      unmetPeerMessages.push(unmet);
    });
  }

  unmetPeerMessages.sort(sortString);

  if (failOnMissingPeerDependencies) {
    for (const msg of messages) {
      logger.error(`❗${msg}`);
    }

    if (messages.length !== 0) {
      throw new Error("Missing peer dependencies");
    }
  }

  for (const msg of messages) {
    logger.debug(`❗ ${msg}`);
  }

  if (unmetPeerMessages.length) {
    logger.info(
      `❗ ${chalk.red(
        `There are ${unmetPeerMessages.length} peer dependencies that have not been met.`
      )}`
    );
  }

  if (unmetPeerMessages.length) {
    logger.info(
      `❗ ${chalk.red("Run")} ${chalk.cyanBright(
        "LOG_LEVEL=debug yarn strict"
      )} ${chalk.red("to see them.")}`
    );
  }

  return { graph: newGraph, missings: unmetPeerMessages };
};

/**
 * Creates a dependency graph
 * @param manifests
 * @param resolutionMap
 * @param failOnMissingPeerDependencies
 * @returns
 */
export function createDependencyGraph(
  manifests: PackageManifest[],
  resolutionMap: ResolutionMap,
  failOnMissingPeerDependencies?: boolean,
  logger?: any
): JsonGraph {
  if (!logger) {
    logger = console;
  }
  const graph = createGraph(
    manifests,
    resolutionMap,
    failOnMissingPeerDependencies,
    logger
  );
  const { graph: graphAsJson } = convertGraphToJson(graph, {
    failOnMissingPeerDependencies,
    logger,
  });

  return graphAsJson;
}

/**
 * Returns just the unmet peer dependencies
 * @param manifests
 * @param resolutionMap
 * @param failOnMissingPeerDependencies
 * @returns
 */
export function getGraphWithUnmetPeers(
  manifests: PackageManifest[],
  resolutionMap: ResolutionMap,
  failOnMissingPeerDependencies?: boolean,
  logger?: typeof console
) {
  if (!logger) {
    logger = console;
  }
  const graph = createGraph(
    manifests,
    resolutionMap,
    failOnMissingPeerDependencies,
    logger
  );
  const { graph: graphAsJson, missings } = convertGraphToJson(graph, {
    failOnMissingPeerDependencies,
    logger,
  });

  return { missings, graph: graphAsJson };
}
