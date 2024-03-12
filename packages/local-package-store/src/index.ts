import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getNodeHashes } from "hash-graph-nodes";
import PQueue from "p-queue";
import { performance, PerformanceObserver } from "perf_hooks";

import { convertGraphToTree } from "./graphToTree";
import { executeTree } from "./treeExecutor";
import { copyFiles } from "./copyFiles";
import type { CopyQueueItem, NodeLoc } from "./copyFiles";
import { getGraphError, getLocationError } from "./inputValidation";

import type { Graph, Node } from "./graph";
export type { Graph, Node } from "./graph";
import chalk from "chalk";

const isCi =
  !!process.env["CI"] || !!process.env["SYSTEM_TEAMFOUNDATIONCOLLECTIONURI"];

const queue = new PQueue({ concurrency: 300 });

const cmdShim: (
  from: string,
  to: string,
) => Promise<void> = require("cmd-shim");

const logger = console;

/**
 * Options to configure the installLocalStore function.
 */
export interface Options {
  /**
   * List of file names that should not be copied over from the cache to the store.
   * This is useful when the cache contains some large files that are not needed in
   * the store (eg. .yarn-metatdata.json or .yarn-tarball.tgz)
   */

  filesToExclude?: string[];
  /**
   * Fails when two dependencies provide the same bin name.
   */
  ignoreBinConflicts?: boolean;

  /**
   * If true, the caching will be skipped
   */
  noCache: boolean;

  /**
   * The type of symlinks to create. This is only applicable to windows machines.
   * The preferred option is "dir" but this requires either windows to be in "developer mode" or running as administrator.
   * See https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/
   */
  symlinkType?: SymlinkType;

  /**
   * If running in debug mode, the install will include symlinks
   */
  debugSymlinks?: boolean;

  /**
   * Show progress on tasks
   */
  showProgress?: boolean;
}

export type SymlinkType = "dir" | "junction";

async function symlinkRelative(
  target: string,
  symlinkPath: string,
): Promise<void> {
  await fs.promises.symlink(
    path.relative(path.dirname(symlinkPath), target),
    symlinkPath,
  );
}

async function symlink(
  targetPath: string,
  symlinkPath: string,
  symlinkType?: SymlinkType,
): Promise<void> {
  // Node on windows doesn't work well with relative paths.
  if (process.platform === "win32") {
    await fs.promises.symlink(targetPath, symlinkPath, symlinkType);
  } else {
    await symlinkRelative(targetPath, symlinkPath);
  }
}

export async function getDestinations(
  graph: Graph,
  location: string,
  options?: Options,
) {
  await validateInput(graph, location, options?.ignoreBinConflicts);

  const hashes = getNodeHashes({
    nodes: graph.nodes.map((n) => ({
      contentHash: `${n.name}+${n.version || "0.0.0"}`,
      id: n.key,
    })),
    links: graph.links.map((l) => ({
      source: l.source,
      target: l.target,
    })),
  });

  const destinations = generateDestinations(hashes, graph, location);
  return destinations;
}

const debug =
  process.env.LOG_LEVEL && Boolean(process.env.LOG_LEVEL.match(/debug|silly/i));

/**
 * Install the given dependency graph in the given folder.
 *
 * @param graph Dependency graph to be installed on disk.
 * @param location Absolute path of an empty directory in which the installation will take place.
 */
export async function installLocalStore(
  graph: Graph,
  location: string,
  options?: Options,
): Promise<void> {
  await validateInput(graph, location, options?.ignoreBinConflicts);

  if (debug) {
    const observer = new PerformanceObserver((items) => {
      const entries = items.getEntries();

      entries.forEach((entry) => {
        logger.debug(`⏰ ${entry.name} took ${entry.duration}ms`);
      });
    });
    observer.observe({ entryTypes: ["measure"] });

    performance.mark("hashes-start");
  }

  const hashes = getNodeHashes({
    nodes: graph.nodes.map((n) => ({
      contentHash: `${n.name}+${n.version || "0.0.0"}`,
      id: n.key,
    })),
    links: graph.links.map((l) => ({
      source: l.source,
      target: l.target,
    })),
  });

  if (debug) {
    performance.mark("hashes-end");
    performance.measure("hashes", "hashes-start", "hashes-end");
    performance.mark("destinations-start");
  }

  const destinations = generateDestinations(hashes, graph, location);

  let cachedPackages = new Set<string>();

  if (!options?.noCache) {
    cachedPackages = await getCachedPackages(graph, hashes, destinations);
  }

  const workspacePackages = graph.nodes
    .filter((n) => n.keepInPlace)
    .reduce<Record<number, Node>>((memo, node) => {
      memo[node.key] = node;

      return memo;
    }, {});

  let t0;
  let duration;
  t0 = performance.now();
  await installNodesInStore(
    destinations,
    graph,
    cachedPackages,
    options?.filesToExclude,
    options?.showProgress,
  );
  duration = Math.round((performance.now() - t0) / 100) / 10;
  isCi && console.log(`copying modules in store took ${duration} s`);

  if (debug) {
    performance.mark("destinations-end");
    performance.measure(
      "destinations",
      "destinations-start",
      "destinations-end",
    );
    performance.mark("install-nodes-start");
  }

  if (debug) {
    performance.mark("install-nodes-end");
    performance.measure(
      "install-nodes",
      "install-nodes-start",
      "install-nodes-end",
    );
    performance.mark("link-nodes-start");
  }

  t0 = performance.now();
  try {
    await linkNodes(
      graph,
      destinations,
      cachedPackages,
      options?.symlinkType || "junction",
      options?.debugSymlinks,
    );
    duration = Math.round((performance.now() - t0) / 100) / 10;
    isCi && console.log(`symlinking packages took ${duration} s`);
  } catch (e) {
    console.log(e);
    throw new Error("Failed to link packages");
  }

  if (debug) {
    performance.mark("link-nodes-end");
    performance.measure("link-nodes", "link-nodes-start", "link-nodes-end");
    performance.mark("create-bins-start");
  }

  try {
    t0 = performance.now();
    await createBins(graph, destinations, cachedPackages);
    duration = Math.round((performance.now() - t0) / 100) / 10;
    isCi && console.log(`creating .bin folders took ${duration} s`);

    if (debug) {
      performance.mark("create-bins-end");
      performance.measure(
        "create-bins",
        "create-bins-start",
        "create-bins-end",
      );
      performance.mark("run-scripts-start");
    }
  } catch (e) {
    console.error(e);
    throw new Error("Failed to create bins");
  }

  t0 = performance.now();
  await runScripts(
    graph,
    destinations,
    cachedPackages,
    hashes,
    workspacePackages,
  );
  duration = Math.round((performance.now() - t0) / 100) / 10;
  isCi && console.log(`Running scripts took ${duration} s`);

  if (debug) {
    performance.mark("run-scripts-end");
    performance.measure("run-scripts", "run-scripts-start", "run-scripts-end");
    performance.clearMarks();
  }
}

const memo = new Map<string, string>();
function getNodeModulesFolder(location: string): string {
  if (memo.has(location)) {
    return memo.get(location)!;
  }
  if (path.basename(path.resolve(location, "..")) === "node_modules") {
    const result = path.resolve(location, "..");
    memo.set(location, result);
    return memo.get(location)!;
  }
  // packages in store with a scope
  if (path.basename(path.resolve(location, "..", "..")) === "node_modules") {
    const result = path.resolve(location, "..", "..");
    memo.set(location, result);
    return memo.get(location)!;
  }
  // local packages
  const result = path.join(location, "node_modules");
  memo.set(location, result);

  return memo.get(location)!;
}

async function getCachedPackages(
  graph: Graph,
  hashes: Map<number, string>,
  destinations: Map<number, string>,
): Promise<Set<string>> {
  const result = new Set<string>();

  const nodes = graph.nodes;
  await Promise.all(
    nodes.map(async (n) => {
      if (n.keepInPlace) {
        // local packages are never cached
        return;
      }
      const loc = destinations.get(n.key)!;
      const cacheFile = path.join(getNodeModulesFolder(loc), ".hash");
      try {
        const oldHash = await fs.promises.readFile(cacheFile, {
          encoding: "utf-8",
        });
        if (oldHash === hashes.get(n.key)) {
          result.add(loc);
        }
      } catch {}
    }),
  );
  return result;
}

async function runScripts(
  graph: Graph,
  destinations: Map<number, string>,
  cachedPackages: Set<string>,
  hashes: Map<number, string>,
  workspacePackages: Record<number, Node>,
): Promise<void> {
  const tree = convertGraphToTree(graph);

  async function executor(component: number): Promise<void> {
    const packages = tree.components.get(component)!.keys;

    await Promise.all(
      packages.map(async (n) => {
        const loc = destinations.get(n)!;
        const isCached = cachedPackages.has(loc);
        const isPackageExternal = !workspacePackages[n];
        const shouldSkipPostinstall = isCached && isPackageExternal;

        if (shouldSkipPostinstall) {
          return;
        }

        try {
          await fs.promises.stat(path.join(loc, "package.json"));
        } catch {
          return;
        }

        const manifest: any = JSON.parse(
          await fs.promises.readFile(path.join(loc, "package.json"), {
            encoding: "utf8",
          }),
        );
        function runScript(scriptName: string) {
          let t0 = performance.now();
          return new Promise<void>((resolve, reject) => {
            try {
              const npmCommand =
                process.platform === "win32" ? "npm.cmd" : "npm";
              const child = spawn(npmCommand, ["run", scriptName], {
                cwd: loc,
              });

              let out: string = "";
              child?.stdout?.on("data", (data) => {
                out += data.toString();
              });

              child?.stderr?.on("data", (data) => {
                out += data.toString();
              });

              child.on("exit", (code) => {
                if (code !== 0 && manifest.name !== "canvas") {
                  //           ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                  // temporary hack to unblock devs on MAC arm.
                  logger.info(
                    `💥 ${chalk.gray(
                      scriptName,
                    )} script failed ${chalk.cyanBright(
                      manifest.name,
                    )} ${chalk.magentaBright(manifest.version)}`,
                  );
                  logger.info(chalk.gray(`> ${manifest.scripts[scriptName]}`));
                  if (out.length) {
                    logger.info(out);
                  }
                  return reject(
                    new Error(`script ${scriptName} failed in ${loc}`),
                  );
                }

                let duration = Math.round((performance.now() - t0) / 100) / 10;
                logger.info(
                  `✅ ${chalk.gray(scriptName)} ${chalk.cyanBright(
                    manifest.name,
                  )} ${chalk.magentaBright(manifest.version)} in ${duration} s`,
                );
                resolve();
              });

              child.on("error", (e) => {
                logger.info(
                  `💥 ${chalk.gray(
                    scriptName,
                  )} script failed ${chalk.cyanBright(
                    manifest.name,
                  )} ${chalk.magentaBright(manifest.version)}`,
                );
                reject(e);
              });
            } catch (e) {
              reject(e);
            }
          });
        }
        if (manifest.scripts && manifest.scripts.install) {
          await runScript("install");
        }
        if (manifest.scripts && manifest.scripts.postinstall) {
          await runScript("postinstall");
        }

        // Doing caching here, that way if something dies in linking, we don't have to do ALL THE THINGS again.
        const dest = destinations.get(n)!;
        const cacheFile = path.join(getNodeModulesFolder(dest), ".hash");
        await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.promises.writeFile(cacheFile, hashes.get(n)!);
      }),
    );
  }

  await executeTree(tree, executor);
}

async function createBins(
  graph: Graph,
  destinations: Map<number, string>,
  cachedPackages: Set<string>,
): Promise<void> {
  const binsMap = new Map<number, Map<string, string>>();
  const binCallCache = new Map();

  graph.nodes.forEach((n) => {
    if (!n.bins) {
      return;
    }
    if (!binsMap.get(n.key)) {
      binsMap.set(n.key, new Map<string, string>());
    }

    Object.keys(n.bins).forEach((binName) => {
      binsMap.get(n.key)!.set(binName, n.bins![binName]);
    });
  });

  const hookPath = process.env["MYS_HOOKS_PATH"];
  if (hookPath) {
    // dynamic require should be ignored by webpack
    const { onLinkBins } = require(hookPath);

    const binLinks = graph.nodes
      .map((n) => ({ source: n.key, target: n.key }))
      .concat(graph.links)
      .flatMap((l) => {
        const bins = binsMap.get(l.target);

        if (!bins) {
          return [];
        }

        const sourceLoc = destinations.get(l.source)!;
        const binFolder = path.join(getNodeModulesFolder(sourceLoc), ".bin");
        const links: any = [];
        for (const [binName, binLocation] of bins) {
          const binLink = path.join(binFolder, binName);
          links.push({ src: sourceLoc, target: binLink });
        }

        return links;
      })
      .filter(Boolean);

    if (onLinkBins) {
      onLinkBins({ cwd: process.cwd() }, binLinks);
    }

    process.exit(1); // don't proceed with install
    return;
  }

  await Promise.all(
    graph.nodes
      .map((n) => ({ source: n.key, target: n.key }))
      .concat(graph.links)
      .map(async (l) => installLink(l)),
  );

  async function installLink({
    source,
    target,
  }: {
    source: number;
    target: number;
  }): Promise<void> {
    const isCached = cachedPackages.has(destinations.get(source)!);

    if (isCached) {
      return;
    }

    const bins = binsMap.get(target);

    if (!bins) {
      return;
    }

    const sourceLoc = destinations.get(source)!;
    const binFolder = path.join(getNodeModulesFolder(sourceLoc), ".bin");

    await fs.promises.mkdir(binFolder, { recursive: true });

    for (const [binName, binLocation] of bins) {
      const binLoc = path.join(destinations.get(target)!, binLocation);
      try {
        await fs.promises.stat(binLoc);
      } catch {
        continue;
      }
      const binLink = path.join(binFolder, binName);

      if (binCallCache.has(binLink)) {
        logger.debug(
          `Attempted to create symlink to ${binLink} twice from ${sourceLoc}`,
        );
        continue;
      }

      binCallCache.set(binLink, sourceLoc);

      await queue.add(async () => {
        if (process.platform === "win32") {
          await cmdShim(binLoc, binLink);
        } else {
          await symlink(binLoc, binLink);
          await fs.promises.chmod(binLink, "777");
        }
      });
    }
  }
}

export async function symlinkExists(filePath: string) {
  try {
    let stat = await fs.promises.lstat(filePath);
    return stat.isSymbolicLink();
  } catch (err) {
    return false;
  }
}

async function linkNodes(
  graph: Graph,
  destinations: Map<number, string>,
  cachedPackages: Set<string>,
  symlinkType: SymlinkType,
  debugSymlinks?: boolean,
): Promise<void> {
  const hookPath = process.env["MYS_HOOKS_PATH"];
  if (hookPath) {
    // dynamic require should be ignored by webpack
    const { onLinkNodes } = require(hookPath);

    const links: any = [];

    graph.links.map((link) => {
      const name = graph.nodes.find((n) => n.key === link.target)!.name;

      const targetPath = destinations.get(link.target)!;
      const symlinkPath = path.join(
        getNodeModulesFolder(destinations.get(link.source)!),
        name,
      );

      links.push({ targetPath, symlinkPath });
    });

    if (onLinkNodes) {
      onLinkNodes({ cwd: process.cwd() }, links);
      return;
    }

    process.exit(0);
  }

  await Promise.all(
    graph.links.map(async (link) => {
      // TODO: this is very bad for perf, improve this.
      const name = graph.nodes.find((n) => n.key === link.target)!.name;

      const targetPath = destinations.get(link.target)!;
      const linkToCreate = path.join(
        getNodeModulesFolder(destinations.get(link.source)!),
        name,
      );

      const isCached = cachedPackages.has(destinations.get(link.source)!);
      if (isCached) {
        return;
      }

      // TODO: we can optimize by only calling this when needed.
      await fs.promises.mkdir(path.dirname(linkToCreate), { recursive: true });

      // const linkExists = await symlinkExists(linkToCreate);
      // const isTargetSymlink = await symlinkExists(targetPath);
      try {
        await symlink(targetPath, linkToCreate, symlinkType);

        if (debugSymlinks) {
          await fs.promises.mkdir(
            path.join(
              getNodeModulesFolder(destinations.get(link.source)!),
              ".children",
            ),
            { recursive: true },
          );
          await symlink(
            getNodeModulesFolder(targetPath),
            path.join(
              getNodeModulesFolder(destinations.get(link.source)!),
              ".children",
              path.basename(path.join(getNodeModulesFolder(targetPath), "..")),
            ),
            symlinkType,
          );
          // Making a link from the child to the parent to make it easy to navigate the dependency graph for debugging purpose.
          await fs.promises.mkdir(
            path.join(getNodeModulesFolder(targetPath), ".parents"),
            { recursive: true },
          );
          await symlink(
            getNodeModulesFolder(destinations.get(link.source)!),
            path.join(
              getNodeModulesFolder(targetPath),
              ".parents",
              path.basename(
                path.join(
                  getNodeModulesFolder(destinations.get(link.source)!),
                  "..",
                ),
              ),
            ),
            symlinkType,
          );
        }
      } catch (err) {
        // TODO: I think we can just ignore this error, but not sure @vincent
        // console.error(err);
      }
    }),
  );
}

export function generateDestinations(
  hashes: Map<number, string>,
  graph: Graph,
  location: string,
): Map<number, string> {
  const result = new Map<number, string>();
  graph.nodes.forEach((n) => {
    const key = n.key;
    const storeEntry = n.keepInPlace
      ? n.location
      : path.join(
          location,
          n.version && n.name
            ? `${n.name.replace(/\//, "-")}@${n.version}-${hashes
                .get(key)!
                .slice(0, 20)}`
            : key.toString(),
        );

    result.set(
      key,
      n.keepInPlace
        ? n.location
        : path.join(storeEntry, "node_modules", n.name),
    );
    n.destination = storeEntry;
  });

  return result;
}

async function installNodesInStore(
  destinations: Map<number, string>,
  graph: Graph,
  cachedPackages: Set<string>,
  exclusionList?: string[],
  showProgress?: boolean,
): Promise<void> {
  const dirActions: CopyQueueItem[] = [];
  const dirsToCopy = new Set<string>();
  const keepInPlaceNodeModulesToDelete: string[] = [];
  graph.nodes.forEach((n) => {
    const key = n.key;
    const nodeLoc: NodeLoc =
      n.location === "memory"
        ? { t: "memory", files: n.files!, buffer: n.buffer! }
        : { t: "disk", loc: n.location };
    const destination = destinations.get(key)!;
    if (n.keepInPlace) {
      keepInPlaceNodeModulesToDelete.push(
        path.join(destination, "node_modules"),
      );
      return;
    }
    if (cachedPackages.has(destination)) {
      return;
    }
    if (dirsToCopy.has(destination)) {
      return;
    }
    dirsToCopy.add(destination);
    dirActions.push({ src: nodeLoc, dest: destination });
  });

  const hookPath = process.env["MYS_HOOKS_PATH"];
  if (hookPath) {
    // dynamic require should be ignored by webpack
    const { onDirActions, onCopyFiles } = require(hookPath);

    if (onDirActions) {
      onDirActions({ cwd: process.cwd() }, dirActions);
    }

    function findFiles(dir: string, files: string[], exclusionList?: string[]) {
      const fs = require("fs");
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (let e of entries) {
        if (exclusionList && exclusionList.includes(e.name)) {
          continue;
        }
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          findFiles(p, files, exclusionList);
        } else {
          files.push(p);
        }
      }
    }

    const files: string[] = [];
    dirActions.forEach((a) =>
      findFiles((a.src as any).loc, files, exclusionList),
    );

    if (onCopyFiles) {
      onCopyFiles({ cwd: process.cwd() }, files);
    }

    return;
  }

  await Promise.all([
    copyFiles(dirActions, exclusionList, showProgress),
    ...keepInPlaceNodeModulesToDelete.map((e) =>
      fs.promises.rm(e, { recursive: true, force: true }),
    ),
  ]);
}

async function validateInput(
  graph: Graph,
  location: string,
  ignoreBinConflicts: boolean | undefined,
): Promise<void> {
  const locationError = await getLocationError(location);
  if (locationError !== undefined) {
    throw new Error(locationError);
  }
  const GrapError = await getGraphError(graph);
  if (GrapError !== undefined) {
    throw new Error(GrapError);
  }
  const binError = getBinError(graph, ignoreBinConflicts);
  if (binError !== undefined) {
    throw new Error(binError);
  }
}

function getBinError(
  graph: Graph,
  ignoreBinConflicts: boolean | undefined,
): string | undefined {
  const errors = graph.nodes
    .map((node) => {
      if (!node.bins) {
        return [];
      }
      return Object.keys(node.bins)
        .map((binName) => {
          if (/\/|\\|\n/.test(binName)) {
            return `Package "${node.key}" exposes a bin script with an invalid name: "${binName}"`;
          }
        })
        .filter((o) => o !== undefined);
    })
    .filter((a) => a.length > 0);
  if (errors.length !== 0) {
    return errors[0]![0]!;
  }

  const binsMap = new Map<number, Set<string>>();
  graph.nodes.forEach((node) => {
    const newSet = new Set<string>();
    if (node.bins) {
      Object.keys(node.bins).forEach((binName) => {
        newSet.add(binName);
      });
    }
    binsMap.set(node.key, newSet);
  });

  const binCollisionErrors: string[] = [];
  const installedBinMap = new Map<number, Set<string>>();
  graph.nodes.forEach((node) => {
    installedBinMap.set(node.key, new Set());
  });
  graph.links.forEach(({ source, target }) => {
    const targetBins = binsMap.get(target)!;
    targetBins.forEach((binName) => {
      if (installedBinMap.get(source)!.has(binName) && !ignoreBinConflicts) {
        binCollisionErrors.push(
          `Several different scripts called "${binName}" need to be installed at the same location (${source}).`,
        );
      }
      installedBinMap.get(source)!.add(binName);
    });
  });

  if (binCollisionErrors.length > 0) {
    return binCollisionErrors[0];
  }

  return undefined;
}
