import objectPath from "object-path";

import { implodeEntry } from "../../lockfile";

import { callThroughHook } from "../../util/hooks.js";
import { MessageError } from "../../errors.js";
import InstallationIntegrityChecker from "../../integrity-checker.js";
import Lockfile from "../../lockfile";
import { stringify as lockStringify } from "../../lockfile";
import * as fetcher from "../../package-fetcher.js";
import * as compatibility from "../../package-compatibility.js";
import PackageResolver from "../../package-resolver.js";
import { registries } from "../../registries/index.js";
import { getExoticResolver } from "../../resolvers/index.js";
import * as constants from "../../constants.js";
import { normalizePattern } from "../../util/normalize-pattern.js";
import * as fs from "../../util/fs.js";
import map from "../../util/map.js";
import WorkspaceLayout from "../../workspace-layout.js";
import ResolutionMap from "../../resolution-map.js";
import guessName from "../../util/guess-name";

const deepEqual = require("deep-equal");
const emoji = require("node-emoji");
const invariant = require("invariant");
const path = require("path");
const semver = require("semver");
const uuid = require("uuid");
const ssri = require("ssri");

const ONE_DAY = 1000 * 60 * 60 * 24;

function normalizeFlags(config, rawFlags) {
  const flags = {
    // install
    har: !!rawFlags.har,
    ignoreCpu: !!rawFlags.ignoreCpu,
    ignorePlatform: !!rawFlags.ignorePlatform,
    ignoreEngines: !!rawFlags.ignoreEngines,
    ignoreScripts: !!rawFlags.ignoreScripts,
    ignoreOptional: !!rawFlags.ignoreOptional,
    force: !!rawFlags.force,
    flat: !!rawFlags.flat,
    lockfile: rawFlags.lockfile !== false,
    pureLockfile: !!rawFlags.pureLockfile,
    updateChecksums: !!rawFlags.updateChecksums,
    skipIntegrityCheck: !!rawFlags.skipIntegrityCheck,
    frozenLockfile: !!rawFlags.frozenLockfile,
    linkDuplicates: !!rawFlags.linkDuplicates,
    checkFiles: !!rawFlags.checkFiles,
    scope: rawFlags.scope || "**",
    extraDependenciesFilepath: rawFlags.extraDependenciesFilepath,

    // add
    peer: !!rawFlags.peer,
    dev: !!rawFlags.dev,
    optional: !!rawFlags.optional,
    exact: !!rawFlags.exact,
    tilde: !!rawFlags.tilde,
    ignoreWorkspaceRootCheck: !!rawFlags.ignoreWorkspaceRootCheck,

    // outdated, update-interactive
    includeWorkspaceDeps: !!rawFlags.includeWorkspaceDeps,

    // add, remove, update
    workspaceRootIsCwd: rawFlags.workspaceRootIsCwd !== false,
  };

  if (config.getOption("ignore-scripts")) {
    flags.ignoreScripts = true;
  }

  if (config.getOption("ignore-cpu")) {
    flags.ignoreCpu = true;
  }

  if (config.getOption("ignore-platform")) {
    flags.ignorePlatform = true;
  }

  if (config.getOption("ignore-engines")) {
    flags.ignoreEngines = true;
  }

  if (config.getOption("ignore-optional")) {
    flags.ignoreOptional = true;
  }

  if (config.getOption("force")) {
    flags.force = true;
  }

  return flags;
}

export class Install {
  constructor(flags, config, reporter, lockfile) {
    this.rootManifestRegistries = [];
    this.rootPatternsToOrigin = map();
    this.lockfile = lockfile;
    this.reporter = reporter;
    this.config = config;
    this.flags = normalizeFlags(config, flags);
    this.resolutions = map(); // Legacy resolutions field used for flat install mode
    this.resolutionMap = new ResolutionMap(config); // Selective resolutions for nested dependencies
    this.resolver = new PackageResolver(config, lockfile, this.resolutionMap);
    this.integrityChecker = new InstallationIntegrityChecker(config);
  }

  /**
   * Create a list of dependency requests from the current directories manifests.
   */

  async fetchRequestFromCwd(ignoreUnusedPatterns = false) {
    const patterns = [];
    const deps = [];
    let resolutionDeps = [];
    const manifest = {};

    const ignorePatterns = [];
    const usedPatterns = [];
    let workspaceLayout;

    // some commands should always run in the context of the entire workspace
    const cwd = this.config.lockfileFolder;

    for (const registry of Object.keys(registries)) {
      const { filename } = registries[registry];
      const loc = path.join(cwd, filename);
      if (!(await fs.exists(loc))) {
        continue;
      }

      this.rootManifestRegistries.push(registry);

      const projectManifestJson = await this.config.readJson(loc);

      Object.assign(this.resolutions, projectManifestJson.resolutions);
      Object.assign(manifest, projectManifestJson);

      this.resolutionMap.init(this.resolutions);
      for (const packageName of Object.keys(
        this.resolutionMap.resolutionsByPackage,
      )) {
        const optional =
          objectPath.has(manifest.optionalDependencies, packageName) &&
          this.flags.ignoreOptional;
        for (const { pattern } of this.resolutionMap.resolutionsByPackage[
          packageName
        ]) {
          resolutionDeps = [
            ...resolutionDeps,
            { registry, pattern, optional, hint: "resolution" },
          ];
        }
      }

      const pushDeps = (depType, manifest, { hint, optional }, isUsed) => {
        if (ignoreUnusedPatterns && !isUsed) {
          return;
        }
        // We only take unused dependencies into consideration to get deterministic hoisting.
        // Since flat mode doesn't care about hoisting and everything is top level and specified then we can safely
        // leave these out.
        if (this.flags.flat && !isUsed) {
          return;
        }
        const depMap = manifest[depType];
        for (const name in depMap) {
          let pattern = name;
          if (!this.lockfile.getLocked(pattern)) {
            // when we use --save we save the dependency to the lockfile with just the name rather than the
            // version combo
            pattern += "@" + depMap[name];
          }

          // normalization made sure packages are mentioned only once
          if (isUsed) {
            usedPatterns.push(pattern);
          } else {
            ignorePatterns.push(pattern);
          }

          this.rootPatternsToOrigin[pattern] = depType;
          patterns.push(pattern);
          deps.push({
            pattern,
            registry,
            hint,
            optional,
            workspaceName: manifest.name,
            workspaceLoc: manifest._loc,
          });
        }
      };

      pushDeps(
        "dependencies",
        projectManifestJson,
        { hint: null, optional: false },
        true,
      );
      pushDeps(
        "devDependencies",
        projectManifestJson,
        { hint: "dev", optional: false },
        !this.config.production,
      );
      pushDeps(
        "optionalDependencies",
        projectManifestJson,
        { hint: "optional", optional: true },
        true,
      );

      if (this.config.workspaceRootFolder) {
        const workspaceLoc = loc;
        const workspacesRoot = path.dirname(workspaceLoc);

        let workspaceManifestJson = projectManifestJson;

        const workspaces = await this.config.resolveWorkspaces(
          workspacesRoot,
          workspaceManifestJson,
        );
        workspaceLayout = new WorkspaceLayout(workspaces, this.config);

        // add virtual manifest that depends on all workspaces, this way package hoisters and resolvers will work fine
        const workspaceDependencies = { ...workspaceManifestJson.dependencies };
        for (const workspaceName of Object.keys(workspaces)) {
          const workspaceManifest = workspaces[workspaceName].manifest;
          workspaceDependencies[workspaceName] = workspaceManifest.version;

          // include dependencies from all workspaces
          if (this.flags.includeWorkspaceDeps) {
            pushDeps(
              "dependencies",
              workspaceManifest,
              { hint: null, optional: false },
              true,
            );
            pushDeps(
              "devDependencies",
              workspaceManifest,
              { hint: "dev", optional: false },
              !this.config.production,
            );
            pushDeps(
              "optionalDependencies",
              workspaceManifest,
              { hint: "optional", optional: true },
              true,
            );
          }
        }
        const virtualDependencyManifest = {
          _uid: "",
          name: `workspace-aggregator-${uuid.v4()}`,
          version: "1.0.0",
          _registry: "npm",
          _loc: workspacesRoot,
          dependencies: workspaceDependencies,
          devDependencies: { ...workspaceManifestJson.devDependencies },
          optionalDependencies: {
            ...workspaceManifestJson.optionalDependencies,
          },
          private: workspaceManifestJson.private,
          workspaces: workspaceManifestJson.workspaces,
        };
        workspaceLayout.virtualManifestName = virtualDependencyManifest.name;
        const virtualDep = {};
        virtualDep[virtualDependencyManifest.name] =
          virtualDependencyManifest.version;
        workspaces[virtualDependencyManifest.name] = {
          loc: workspacesRoot,
          manifest: virtualDependencyManifest,
        };

        pushDeps(
          "workspaces",
          { workspaces: virtualDep },
          { hint: "workspaces", optional: false },
          true,
        );

        const implicitWorkspaceDependencies = { ...workspaceDependencies };

        for (const type of constants.OWNED_DEPENDENCY_TYPES) {
          for (const dependencyName of Object.keys(
            projectManifestJson[type] || {},
          )) {
            delete implicitWorkspaceDependencies[dependencyName];
          }
        }

        pushDeps(
          "dependencies",
          { dependencies: implicitWorkspaceDependencies },
          { hint: "workspaces", optional: false },
          true,
        );
      }

      break;
    }

    // inherit root flat flag
    if (manifest.flat) {
      this.flags.flat = true;
    }

    return {
      requests: [...resolutionDeps, ...deps],
      patterns,
      manifest,
      usedPatterns,
      ignorePatterns,
      workspaceLayout,
    };
  }

  /**
   * TODO description
   */

  prepareRequests(requests) {
    return requests;
  }

  preparePatterns(patterns) {
    return patterns;
  }

  async prepareManifests() {
    const manifests = await this.config.getRootManifests();
    return manifests;
  }

  getFilteredResolvedPatterns(workspaceLayout) {
    const resolvedPatterns = {};
    Object.keys(this.resolver.patterns).forEach((pattern) => {
      if (!workspaceLayout || !workspaceLayout.getManifestByPattern(pattern)) {
        resolvedPatterns[pattern] = this.resolver.patterns[pattern];
      }
    });

    return resolvedPatterns;
  }

  async compareOriginalVsResolvedLockfile(workspaceLayout) {
    const resolvedPatterns = this.getFilteredResolvedPatterns(workspaceLayout);
    const resolvedLockfile = new Lockfile().getLockfile(resolvedPatterns);

    const originalLockfile = (
      await Lockfile.fromDirectory(this.config.lockfileFolder, this.reporter)
    ).cache;
    // the resolved lock file has "imploded" entries, need to do the same for the original
    Object.keys(originalLockfile).forEach(
      (key) =>
        (originalLockfile[key] = implodeEntry(key, originalLockfile[key])),
    );

    return deepEqual(originalLockfile, resolvedLockfile);
  }

  async bailout(patterns, workspaceLayout) {
    if (this.flags.skipIntegrityCheck || this.flags.force) {
      return false;
    }
    const lockfileCache = this.lockfile.cache;
    if (!lockfileCache) {
      return false;
    }
    const lockfileClean = this.lockfile.parseResultType === "success";
    const match = await this.integrityChecker.check(
      patterns,
      lockfileCache,
      this.flags,
      workspaceLayout,
    );

    const haveLockfile = await fs.exists(
      path.join(this.config.lockfileFolder, constants.LOCKFILE_FILENAME),
    );

    const lockfileIntegrityPresent =
      !this.lockfile.hasEntriesExistWithoutIntegrity();
    const integrityBailout =
      lockfileIntegrityPresent || !this.config.autoAddIntegrity;

    if (
      match.integrityMatches &&
      haveLockfile &&
      lockfileClean &&
      integrityBailout
    ) {
      this.reporter.success(this.reporter.lang("upToDate"));
      return true;
    }

    if (match.integrityFileMissing && haveLockfile) {
      return false;
    }

    if (match.hardRefreshRequired) {
      return false;
    }

    if (!patterns.length && !match.integrityFileMissing) {
      this.reporter.success(this.reporter.lang("nothingToInstall"));
      await this.createEmptyManifestFolders();
      await this.saveLockfileAndIntegrity(patterns, workspaceLayout);
      return true;
    }

    return false;
  }

  /**
   * Produce empty folders for all used root manifests.
   */

  async createEmptyManifestFolders() {
    if (this.config.modulesFolder) {
      // already created
      return;
    }

    for (const registryName of this.rootManifestRegistries) {
      const { folder } = this.config.registries[registryName];
      await fs.mkdirp(path.join(this.config.lockfileFolder, folder));
    }
  }

  /**
   * TODO description
   */

  markIgnored(patterns) {
    for (const pattern of patterns) {
      const manifest = this.resolver.getStrictResolvedPattern(pattern);
      const ref = manifest._reference;
      invariant(ref, "expected package reference");

      // just mark the package as ignored. if the package is used by a required package, the hoister
      // will take care of that.
      ref.ignore = true;
    }
  }

  /**
   * helper method that gets only recent manifests
   * used by global.ls command
   */
  async getFlattenedDeps() {
    const { requests: depRequests, patterns: rawPatterns } =
      await this.fetchRequestFromCwd();

    await this.resolver.init(depRequests, {});

    const manifests = await fetcher.fetch(
      this.resolver.getManifests(),
      this.config,
    );
    this.resolver.updateManifests(manifests);

    return this.flatten(rawPatterns);
  }

  /**
   * TODO description
   */

  async init() {
    // warn if we have a shrinkwrap
    if (
      await fs.exists(
        path.join(
          this.config.lockfileFolder,
          constants.NPM_SHRINKWRAP_FILENAME,
        ),
      )
    ) {
      this.reporter.warn(this.reporter.lang("shrinkwrapWarning"));
    }

    // warn if we have an npm lockfile
    if (
      await fs.exists(
        path.join(this.config.lockfileFolder, constants.NPM_LOCK_FILENAME),
      )
    ) {
      this.reporter.warn(this.reporter.lang("npmLockfileWarning"));
    }

    let flattenedTopLevelPatterns = [];
    const {
      requests: depRequests,
      patterns: rawPatterns,
      ignorePatterns,
      workspaceLayout,
      manifest,
    } = await this.fetchRequestFromCwd();
    let topLevelPatterns = [];

    if (compatibility.shouldCheck(manifest, this.flags)) {
      await this.checkCompatibility();
    }

    let extraDependenciesFromFile = {};
    const extraDependenciesFilepath = path.resolve(
      process.cwd(),
      this.flags.extraDependenciesFilepath || "extraDependencies.json",
    );

    try {
      extraDependenciesFromFile = JSON.parse(
        await fs.readFile(extraDependenciesFilepath, "utf-8"),
      );
    } catch (e) {
      this.reporter.warn(
        this.reporter.lang(
          "extraDependenciesNotFoundError",
          extraDependenciesFilepath,
        ),
      );
    }

    const extraDependencies = {
      ...(extraDependenciesFromFile || {}),
      ...(manifest.extraDependencies || {}),
    };

    await this.resolver.init(this.prepareRequests(depRequests), {
      isFlat: this.flags.flat,
      isFrozen: this.flags.frozenLockfile,
      workspaceLayout,
      extraDependencies,
      activity: this.activity,
    });
    topLevelPatterns = this.preparePatterns(rawPatterns);
    flattenedTopLevelPatterns = await this.flatten(topLevelPatterns);

    if (this.flags.frozenLockfile) {
      const lockfileCache = this.lockfile.cache;
      if (!lockfileCache) {
        return false;
      }
      const lockfileClean = this.lockfile.parseResultType === "success";
      const match = await this.integrityChecker.check(
        topLevelPatterns,
        lockfileCache,
        this.flags,
        workspaceLayout,
      );

      if (
        !lockfileClean ||
        match.missingPatterns.length > 0 ||
        !(await this.compareOriginalVsResolvedLockfile(workspaceLayout))
      ) {
        throw new MessageError(this.reporter.lang("frozenLockfileError"));
      }
    }

    const workspaces = Object.keys(
      this.resolver.workspaceLayout.workspaces,
    ).filter((n) => n !== this.resolver.workspaceLayout.virtualManifestName);

    const inScope = require("micromatch")(workspaces, this.flags.scope);

    this.markIgnored(ignorePatterns);

    const aggregator =
      this.resolver.patterns[
        `${this.resolver.workspaceLayout.virtualManifestName}@1.0.0`
      ];

    // Redefine the dependencies of the workspaces aggregator to only include dependencies in scope.
    aggregator._reference.dependencies = Object.keys(
      manifest.dependencies || {},
    )
      .map((k) => `${k}@${manifest.dependencies[k]}`)
      .concat(
        Object.keys(manifest.devDependencies || {}).map(
          (k) => `${k}@${manifest.devDependencies[k]}`,
        ),
      )
      .concat(inScope.map((n) => this.resolver.patternsByPackage[n][0]));

    const manifests = await fetcher.fetch(
      [
        ...this.resolver.getTopologicalManifests([
          `${this.resolver.workspaceLayout.virtualManifestName}@1.0.0`,
        ]),
      ],
      this.config,
    );

    this.resolver.updateManifests(manifests);
    await compatibility.check(
      this.resolver.getManifests(),
      this.config,
      this.flags.ignoreEngines,
    );
    const resolutionMap = {};
    Object.keys(this.resolver.patterns).forEach((k) => {
      const name = this.resolver.patterns[k].name;
      const atIndex = k.slice(1).indexOf("@");
      const range = k.slice(1 + atIndex + 1);
      const version = this.resolver.patterns[k].version;
      resolutionMap[name] = resolutionMap[name] || {};
      resolutionMap[name][range] = version;
    });

    // Adds top level package.
    manifests.push({
      ...manifest,
      isRoot: true,
      _loc: path.join(process.cwd(), "package.json"),
    });

    let modifiedManifests = manifests.map((m) => {
      if (Object.keys(extraDependencies || {}).includes(m.name)) {
        let newManifest = { ...m };
        const candidates = extraDependencies[m.name] || {};

        Object.keys(candidates)
          .filter((range) =>
            semver.satisfies(m.version, range, { includePrerelease: true }),
          )
          .forEach((c) => {
            Object.assign(newManifest, {
              dependencies: {
                ...(m.dependencies || {}),
                ...(candidates[c].dependencies || {}),
              },
              peerDependencies: {
                ...(m.peerDependencies || {}),
                ...(candidates[c].peerDependencies || {}),
              },
              peerDependenciesMeta: {
                ...(m.peerDependenciesMeta || {}),
                ...(candidates[c].peerDependenciesMeta || {}),
              },
            });
          });

        return newManifest;
      }

      return { ...m };
    });

    const locationMap = modifiedManifests
      .filter((o) => !o.name.startsWith("workspace-aggregator-"))
      .filter((o) => !(o._reference && o._reference.ignore))
      .filter((o) => !o.ignore)
      .map((o) => {
        // Remove the bundled dependencies from the list of dependencies
        const dependencies = o.dependencies || {};
        const bundled = o.bundleDependencies || o.bundledDependencies || [];
        bundled.forEach((b) => {
          delete dependencies[b];
        });
        return {
          name: o.name,
          version: o.version,
          location: o._loc || "memory",
          isLocal: o._loc && o._loc.startsWith(process.cwd()),
          isRoot: o.isRoot,
          files: o._files,
          buffer: o._buffer,
          bin: o.bin,
          dependencies,
          optionalDependencies: o.optionalDependencies, // TODO: remove these and remove the unfulfilled optional dependencies instead.
          peerDependencies: {
            ...(o.peerDependenciesMeta
              ? Object.keys(o.peerDependenciesMeta)
                  .map((k) => ({ [k]: "*" }))
                  .reduce((a, n) => ({ ...a, ...n }), {})
              : {}),
            ...(o.peerDependencies || {}),
          },
          peerDependenciesMeta: o.peerDependenciesMeta,
          devDependencies:
            (o._loc && o._loc.startsWith(process.cwd()) && o.devDependencies) ||
            undefined,
        };
      });

    this.installMaps = { resolutionMap, locationMap };

    // fin!
    await this.saveLockfileAndIntegrity(topLevelPatterns, workspaceLayout);
    this.config.requestManager.clearCache();

    return flattenedTopLevelPatterns;
  }

  async checkCompatibility() {
    const { manifest } = await this.fetchRequestFromCwd();
    await compatibility.checkOne(
      manifest,
      this.config,
      this.flags.ignoreEngines,
    );
  }

  /**
   * Check if we should run the cleaning step.
   */

  shouldClean() {
    return fs.exists(
      path.join(this.config.lockfileFolder, constants.CLEAN_FILENAME),
    );
  }

  /**
   * TODO
   */

  async flatten(patterns) {
    if (!this.flags.flat) {
      return patterns;
    }

    const flattenedPatterns = [];

    for (const name of this.resolver.getAllDependencyNamesByLevelOrder(
      patterns,
    )) {
      const infos = this.resolver
        .getAllInfoForPackageName(name)
        .filter((manifest) => {
          const ref = manifest._reference;
          invariant(ref, "expected package reference");
          return !ref.ignore;
        });

      if (infos.length === 0) {
        continue;
      }

      if (infos.length === 1) {
        // single version of this package
        // take out a single pattern as multiple patterns may have resolved to this package
        flattenedPatterns.push(this.resolver.patternsByPackage[name][0]);
        continue;
      }

      const options = infos.map((info) => {
        const ref = info._reference;
        invariant(ref, "expected reference");
        return {
          // TODO `and is required by {PARENT}`,
          name: this.reporter.lang(
            "manualVersionResolutionOption",
            ref.patterns.join(", "),
            info.version,
          ),

          value: info.version,
        };
      });
      const versions = infos.map((info) => info.version);
      let version;

      const resolutionVersion = this.resolutions[name];
      if (resolutionVersion && versions.indexOf(resolutionVersion) >= 0) {
        // use json `resolution` version
        version = resolutionVersion;
      } else {
        version = await this.reporter.select(
          this.reporter.lang("manualVersionResolution", name),
          this.reporter.lang("answer"),
          options,
        );
        this.resolutions[name] = version;
      }

      flattenedPatterns.push(
        this.resolver.collapseAllVersionsOfPackage(name, version),
      );
    }

    // save resolutions to their appropriate root manifest
    if (Object.keys(this.resolutions).length) {
      const manifests = await this.config.getRootManifests();

      for (const name in this.resolutions) {
        const version = this.resolutions[name];

        const patterns = this.resolver.patternsByPackage[name];
        if (!patterns) {
          continue;
        }

        let manifest;
        for (const pattern of patterns) {
          manifest = this.resolver.getResolvedPattern(pattern);
          if (manifest) {
            break;
          }
        }
        invariant(manifest, "expected manifest");

        const ref = manifest._reference;
        invariant(ref, "expected reference");

        const object = manifests[ref.registry].object;
        object.resolutions = object.resolutions || {};
        object.resolutions[name] = version;
      }

      await this.config.saveRootManifests(manifests);
    }

    return flattenedPatterns;
  }

  /**
   * Remove offline tarballs that are no longer required
   */

  async pruneOfflineMirror(lockfile) {
    const mirror = this.config.getOfflineMirrorPath();
    if (!mirror) {
      return;
    }

    const requiredTarballs = new Set();
    for (const dependency in lockfile) {
      const resolved = lockfile[dependency].resolved;
      if (resolved) {
        const basename = path.basename(resolved.split("#")[0]);
        if (dependency[0] === "@" && basename[0] !== "@") {
          requiredTarballs.add(`${dependency.split("/")[0]}-${basename}`);
        }
        requiredTarballs.add(basename);
      }
    }

    const mirrorFiles = await fs.walk(mirror);
    for (const file of mirrorFiles) {
      const isTarball = path.extname(file.basename) === ".tgz";
      // if using experimental-pack-script-packages-in-mirror flag, don't unlink prebuilt packages
      const hasPrebuiltPackage = file.relative.startsWith("prebuilt/");
      if (
        isTarball &&
        !hasPrebuiltPackage &&
        !requiredTarballs.has(file.basename)
      ) {
        await fs.unlink(file.absolute);
      }
    }
  }

  /**
   * Save updated integrity and lockfiles.
   */

  async saveLockfileAndIntegrity(patterns, workspaceLayout) {
    const resolvedPatterns = this.getFilteredResolvedPatterns(workspaceLayout);

    // TODO this code is duplicated in a few places, need a common way to filter out workspace patterns from lockfile
    patterns = patterns.filter(
      (p) => !workspaceLayout || !workspaceLayout.getManifestByPattern(p),
    );

    const lockfileBasedOnResolver = this.lockfile.getLockfile(resolvedPatterns);

    if (this.config.pruneOfflineMirror) {
      await this.pruneOfflineMirror(lockfileBasedOnResolver);
    }

    // write integrity hash
    await this.integrityChecker.save(
      patterns,
      lockfileBasedOnResolver,
      this.flags,
      workspaceLayout,
    );

    // --no-lockfile or --pure-lockfile or --frozen-lockfile
    if (
      this.flags.lockfile === false ||
      this.flags.pureLockfile ||
      this.flags.frozenLockfile
    ) {
      return;
    }

    const lockFileHasAllPatterns = patterns.every((p) =>
      this.lockfile.getLocked(p),
    );
    const lockfilePatternsMatch = Object.keys(this.lockfile.cache || {}).every(
      (p) => lockfileBasedOnResolver[p],
    );
    const resolverPatternsAreSameAsInLockfile = Object.keys(
      lockfileBasedOnResolver,
    ).every((pattern) => {
      const manifest = this.lockfile.getLocked(pattern);
      return (
        manifest &&
        manifest.resolved === lockfileBasedOnResolver[pattern].resolved &&
        deepEqual(
          manifest.prebuiltVariants,
          lockfileBasedOnResolver[pattern].prebuiltVariants,
        )
      );
    });
    const integrityPatternsAreSameAsInLockfile = Object.keys(
      lockfileBasedOnResolver,
    ).every((pattern) => {
      const existingIntegrityInfo = lockfileBasedOnResolver[pattern].integrity;
      if (!existingIntegrityInfo) {
        // if this entry does not have an integrity, no need to re-write the lockfile because of it
        return true;
      }
      const manifest = this.lockfile.getLocked(pattern);
      if (manifest && manifest.integrity) {
        const manifestIntegrity = ssri.stringify(manifest.integrity);
        return manifestIntegrity === existingIntegrityInfo;
      }
      return false;
    });

    // remove command is followed by install with force, lockfile will be rewritten in any case then
    if (
      !this.flags.force &&
      this.lockfile.parseResultType === "success" &&
      lockFileHasAllPatterns &&
      lockfilePatternsMatch &&
      resolverPatternsAreSameAsInLockfile &&
      integrityPatternsAreSameAsInLockfile &&
      patterns.length
    ) {
      return;
    }

    // build lockfile location
    const loc = path.join(
      this.config.lockfileFolder,
      constants.LOCKFILE_FILENAME,
    );

    // write lockfile
    const lockSource = lockStringify(
      lockfileBasedOnResolver,
      false,
      this.config.enableLockfileVersions,
    );
    await fs.writeFilePreservingEol(loc, lockSource);

    this._logSuccessSaveLockfile();
  }

  _logSuccessSaveLockfile() {
    this.reporter.success(this.reporter.lang("savedLockfile"));
  }

  /**
   * Load the dependency graph of the current install. Only does package resolving and wont write to the cwd.
   */
  async hydrate(ignoreUnusedPatterns) {
    const request = await this.fetchRequestFromCwd([], ignoreUnusedPatterns);
    const {
      requests: depRequests,
      patterns: rawPatterns,
      ignorePatterns,
      workspaceLayout,
    } = request;

    await this.resolver.init(depRequests, {
      isFlat: this.flags.flat,
      isFrozen: this.flags.frozenLockfile,
      workspaceLayout,
    });
    await this.flatten(rawPatterns);
    this.markIgnored(ignorePatterns);

    // fetch packages, should hit cache most of the time
    const manifests = await fetcher.fetch(
      this.resolver.getManifests(),
      this.config,
    );
    this.resolver.updateManifests(manifests);
    await compatibility.check(
      this.resolver.getManifests(),
      this.config,
      this.flags.ignoreEngines,
    );

    // expand minimal manifests
    for (const manifest of this.resolver.getManifests()) {
      const ref = manifest._reference;
      invariant(ref, "expected reference");
      const { type } = ref.remote;
      // link specifier won't ever hit cache
      let loc = "";
      if (type === "link") {
        continue;
      } else if (type === "workspace") {
        if (!ref.remote.reference) {
          continue;
        }
        loc = ref.remote.reference;
      } else {
        loc = this.config.generateModuleCachePath(ref);
      }
      const newPkg = await this.config.readManifest(loc);
      await this.resolver.updateManifest(ref, newPkg);
    }

    return request;
  }

  /**
   * Check for updates every day and output a nag message if there's a newer version.
   */

  checkUpdate() {
    if (this.config.nonInteractive) {
      // don't show upgrade dialog on CI or non-TTY terminals
      return;
    }

    // don't check if disabled
    if (this.config.getOption("disable-self-update-check")) {
      return;
    }

    // only check for updates once a day
    const lastUpdateCheck =
      Number(this.config.getOption("lastUpdateCheck")) || 0;
    if (lastUpdateCheck && Date.now() - lastUpdateCheck < ONE_DAY) {
      return;
    }

    this._checkUpdate().catch(() => {
      // swallow errors
    });
  }
}

export async function install(config, reporter, flags, lockfile) {
  await wrapLifecycle(config, flags, async () => {
    const install = new Install(flags, config, reporter, lockfile);
    await install.init();
  });
}

async function wrapLifecycle(config, flags, factory) {
  await config.executeLifecycleScript("preinstall");

  await factory();

  // npm behaviour, seems kinda funky but yay compatibility
  await config.executeLifecycleScript("install");
  await config.executeLifecycleScript("postinstall");

  if (!config.production) {
    if (!config.disablePrepublish) {
      await config.executeLifecycleScript("prepublish");
    }
    await config.executeLifecycleScript("prepare");
  }
}
