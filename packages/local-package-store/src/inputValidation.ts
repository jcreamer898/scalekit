import * as fs from "fs";
import * as path from "path";

import type { Graph } from "./graph";

export async function getGraphError(graph: Graph): Promise<string | undefined> {
  const dupKey = findDups(graph.nodes.map((n) => n.key));
  if (dupKey !== undefined) {
    return `Multiple nodes have the following key: "${dupKey}"`;
  }
  const notAbsoluteLocations = graph.nodes.filter(
    (n) => n.location !== "memory" && !path.isAbsolute(n.location),
  );
  if (notAbsoluteLocations.length > 0) {
    return `Location of a node is not absolute: "${notAbsoluteLocations[0].location}"`;
  }

  const nodesWithInvalidName = graph.nodes.filter(
    (n) =>
      !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-zA-Z0-9-~][a-zA-Z0-9-._~]*$/.test(
        n.name,
      ),
  );
  if (nodesWithInvalidName.length > 0) {
    return `Package name invalid: "${nodesWithInvalidName[0].name}"`;
  }

  const notFolderLocations = (
    await Promise.all(
      graph.nodes.map(async (n) => {
        if (n.location === "memory") {
          return;
        }
        try {
          const stats = await fs.promises.stat(n.location);
          return !stats.isDirectory() && n.location;
        } catch {
          /**
           * The location does not exist, this error is treated separately.
           */
          return undefined;
        }
      }),
    )
  ).filter(Boolean);

  if (notFolderLocations.length > 0) {
    return `Location of a node is not a directory: "${notFolderLocations[0]}"`;
  }

  const nodeIds = new Set<number>();
  graph.nodes.forEach((n) => {
    nodeIds.add(n.key);
  });

  const linksWithWrongSource = graph.links.filter(
    (l) => !nodeIds.has(l.source),
  );

  if (linksWithWrongSource.length > 0) {
    return `Invalid link source: "${linksWithWrongSource[0].source}"`;
  }

  const linksWithWrongTarget = graph.links.filter(
    (l) => !nodeIds.has(l.target),
  );

  if (linksWithWrongTarget.length > 0) {
    return `Invalid link target: "${linksWithWrongTarget[0].target}"`;
  }

  const dependenciesWithSameNames: {
    source: number;
    targetName: string;
  }[] = findDependenciesWithSameName(graph);
  if (dependenciesWithSameNames.length > 0) {
    const source = dependenciesWithSameNames[0].source;
    const targetName = dependenciesWithSameNames[0].targetName;
    return `Package "${source}" depends on multiple packages called "${targetName}"`;
  }
}

function findDependenciesWithSameName(
  graph: Graph,
): { source: number; targetName: string }[] {
  const keyToNameMap = new Map<number, string>();
  const dependenciesMap = new Map<number, Set<string>>();
  const result: { source: number; targetName: string }[] = [];

  graph.nodes.forEach((n) => {
    keyToNameMap.set(n.key, n.name);
  });

  graph.links.forEach((l) => {
    const targetName = keyToNameMap.get(l.target)!;
    if (!dependenciesMap.get(l.source)) {
      dependenciesMap.set(l.source, new Set<string>());
    }
    if (dependenciesMap.get(l.source)!.has(targetName)) {
      result.push({ source: l.source, targetName });
    } else {
      dependenciesMap.get(l.source)!.add(targetName);
    }
  });

  return result;
}

function findDups<T>(array: T[]): T | undefined {
  const found = new Set();

  for (const item of array) {
    if (found.has(item)) {
      return item;
    } else {
      found.add(item);
    }
  }

  return;
}

export async function getLocationError(
  location: string,
): Promise<string | undefined> {
  if (location === "memory") {
    return;
  }
  if (!path.isAbsolute(location)) {
    return `Location is not an absolute path: "${location}"`;
  }
  try {
    const stats = await fs.promises.stat(location);
    if (!stats.isDirectory()) {
      return `Location is not a directory: "${location}"`;
    }
  } catch (e) {
    return `Location does not exist: "${location}"`;
  }
}
