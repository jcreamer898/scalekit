import { Command } from "../command";
import { Option } from "commander";
import { createDependencyGraph } from "@scalekit/node-dependency-graph";
import {
  installLocalStore,
  Graph,
  SymlinkType,
} from "@scalekit/local-package-store";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { createInstaller } from "../installer";
import type { Logger } from "../logger";

/**
 * Call at the beginning of a long running task, returns a funtion to call which returns total execution time
 */
const measure = () => {
  const now = performance.now();
  return () => {
    const end = performance.now();
    return Math.round(end - now);
  };
};

interface InstallOptions {
  logger: Logger;
  noCache: boolean;
  symlinkType: SymlinkType;
  debugSymlinks: boolean;
  frozenLockfile: boolean;
  showProgress: boolean;
  extraDependenciesFilepath?: string;
}

/**
 * The actual installation happens in here and takes scope as a parameter
 */
async function install(
  args,
  {
    logger,
    noCache,
    symlinkType,
    debugSymlinks,
    frozenLockfile,
    showProgress,
    extraDependenciesFilepath,
  }: InstallOptions
): Promise<void> {
  const scope = args;

  const storePath = process.env["MYS_GLOBAL_STORE"] || path.resolve(".store");

  logger.silly("🤡 silly loglevel");
  logger.debug("🐛 debug loglevel");
  logger.silly(`Installing scope: ${scope}`);

  const endTotal = measure();

  logger.info(chalk.cyanBright("📦 Running midgard-yarn-strict."));
  logger.info(chalk.grey("🌎 Downloading packages..."));

  let end = measure();
  const installer = await createInstaller({
    scope,
    frozenLockfile,
    showProgress,
    extraDependenciesFilepath,
  });
  let total = end();

  logger.info(chalk.grey(`📦 Downloaded in ${total}ms.`));
  const { resolutionMap, locationMap } = installer.installMaps;

  locationMap.forEach((o) => {
    if (o.isLocal) {
      o.peerDependencies = undefined;
    }
  });

  locationMap
    .filter((n) => n.isLocal)
    .forEach((n) => {
      const { name, version } = n;
      if (!resolutionMap[name]) {
        resolutionMap[name] = {};
      }
      resolutionMap[name]["*"] = version;
    });

  logger.info(chalk.grey("🤝 Creating a dependency graph."));
  end = measure();
  const graph = createDependencyGraph(locationMap, resolutionMap, false);
  total = end();
  logger.info(chalk.grey(`🤝 Graph created in ${total}ms.`));

  const locationMapMap = new Map();
  const isLocalMap = new Map();
  locationMap.forEach((o) => {
    if (!locationMapMap.get(o.name)) {
      locationMapMap.set(o.name, new Map());
    }
    if (!isLocalMap.get(o.name)) {
      isLocalMap.set(o.name, new Map());
    }
    isLocalMap.get(o.name).set(o.version, o.isLocal);
    locationMapMap.get(o.name).set(o.version, {
      ...o,
      location: o.location.replace(/.package\.json$/, ""),
    });
  });

  await fs.promises.mkdir(storePath, { recursive: true });

  const newGraph: Graph = {
    nodes: graph.nodes.map((n) => {
      let bins = undefined;
      const pkg = locationMapMap.get(n.name).get(n.version);
      const { name } = n;

      if (pkg.bin) {
        if (typeof pkg.bin === "string") {
          const packageNameSplit = name.split("/");
          const binName = packageNameSplit[packageNameSplit.length - 1];
          bins = { [binName]: pkg.bin };
        } else {
          bins = pkg.bin;
        }
      }

      return {
        name: n.name,
        key: n.id,
        keepInPlace: isLocalMap.get(n.name).get(n.version),
        isRoot: pkg.isRoot,
        bins,
        files: pkg.files,
        buffer: pkg.buffer,
        location: pkg.location,
        version: pkg.version,
      };
    }),
    links: graph.links.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
    })),
  };

  console.log(chalk.grey("🔗 Setting up the store, and linking dependencies."));

  end = measure();
  await installLocalStore(newGraph, storePath, {
    ignoreBinConflicts: true,
    filesToExclude: [".yarn-metadata.json", ".yarn-tarball.tgz"],
    noCache,
    symlinkType,
    debugSymlinks,
    showProgress,
  }),
    (total = end());
  logger.info(chalk.grey(`🔗 Linking done in ${total}ms.`));

  const totalTime = endTotal();
  console.log(chalk.greenBright(`🎉 Done. Took ${totalTime}ms.`));
}

export const init: Command = (program, { logger }) => {
  const cmd = program
    .argument("[scope]", "package scope")
    .allowUnknownOption()
    .option("--skip-cache", "run without cache")
    .addOption(
      new Option(
        "--symlink-type <type>",
        'type of symlink to create. This is only applicable to windows machines. The preferred option is "dir" but this requires windows to be in "developer mode". See https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/'
      ).choices(["junction", "dir"])
    )
    .option(
      "--debug-symlinks",
      "add .children and .parent symlinks to the node_modules directories"
    )
    .option(
      "--frozen-lockfile",
      "Will not update the lockfile, and throw an error if the lockfile is out of date",
      false
    )
    .option("--show-progress", "Show progress while tasks run", false)
    .option(
      "-e, --extra-dependencies-filepath <string>",
      "Filepath to extraDependencies file (relative to current working directory)"
    );

  cmd.action(async (scope, opts) => {
    try {
      await install(scope, {
        frozenLockfile: opts.frozenLockfile,
        logger,
        noCache: opts.skipCache,
        symlinkType: opts.symlinkType,
        debugSymlinks: opts.debugSymlinks,
        showProgress: opts.showProgress,
        extraDependenciesFilepath: opts.extraDependenciesFilepath,
      });
    } catch (e) {
      logger.info(
        `💥 ${chalk.redBright("An error ocurred while installing.")} `
      );
      if (e.message) {
        logger.info(e.message);
      } else if (e) {
        logger.info(e);
      }
      if (e.stack) {
        logger.info(e.stack);
      }
      process.exit(1);
    }
  });
};
