import path from "path";

import invariant from "invariant";
import semver from "semver";

import { cleanDependencies } from "./util/normalize-manifest/validate.js";
import Lockfile from "./lockfile";
import PackageReference from "./package-reference.js";
import { registries as registryResolvers } from "./resolvers/index.js";
import { MessageError } from "./errors.js";
import * as constants from "./constants.js";
import * as versionUtil from "./util/version.js";
import WorkspaceResolver from "./resolvers/contextual/workspace-resolver.js";
import { getExoticResolver } from "./resolvers/index.js";
import * as fs from "./util/fs.js";
import { normalizePattern } from "./util/normalize-pattern.js";

const micromatch = require("micromatch");

export default class PackageRequest {
  constructor(req, resolver) {
    this.parentRequest = req.parentRequest;
    this.parentNames = req.parentNames || [];
    this.lockfile = resolver.lockfile;
    this.registry = req.registry;
    this.reporter = resolver.reporter;
    this.resolver = resolver;
    this.optional = req.optional;
    this.hint = req.hint;
    this.pattern = req.pattern;
    this.config = resolver.config;
    this.foundInfo = null;
    this.activity = resolver.activity;
  }

  init() {
    this.resolver.usedRegistries.add(this.registry);
  }

  getLocked(remoteType) {
    // always prioritise root lockfile
    const shrunk = this.lockfile.getLocked(this.pattern);

    if (shrunk && shrunk.resolved) {
      const resolvedParts = versionUtil.explodeHashedUrl(shrunk.resolved);

      // Detect Git protocols (git://HOST/PATH or git+PROTOCOL://HOST/PATH)
      const preferredRemoteType = /^git(\+[a-z0-9]+)?:\/\//.test(
        resolvedParts.url,
      )
        ? "git"
        : remoteType;

      return {
        name: shrunk.name,
        version: shrunk.version,
        _uid: shrunk.uid,
        _remote: {
          resolved: shrunk.resolved,
          type: preferredRemoteType,
          reference: resolvedParts.url,
          hash: resolvedParts.hash,
          integrity: shrunk.integrity,
          registry: shrunk.registry,
          packageName: shrunk.name,
        },
        optionalDependencies: shrunk.optionalDependencies || {},
        dependencies: shrunk.dependencies || {},
        prebuiltVariants: shrunk.prebuiltVariants || {},
      };
    } else {
      return null;
    }
  }

  /**
   * If the input pattern matches a registry one then attempt to find it on the registry.
   * Otherwise fork off to an exotic resolver if one matches.
   */

  async findVersionOnRegistry(pattern) {
    const { range, name } = await this.normalize(pattern);

    const exoticResolver = getExoticResolver(range);
    if (exoticResolver) {
      let data = await this.findExoticVersionInfo(exoticResolver, range);

      // clone data as we're manipulating it in place and this could be resolved multiple
      // times
      data = Object.assign({}, data);

      // this is so the returned package response uses the overridden name. ie. if the
      // package's actual name is `bar`, but it's been specified in the manifest like:
      //   "foo": "http://foo.com/bar.tar.gz"
      // then we use the foo name
      data.name = name;
      return data;
    }

    const Resolver = this.getRegistryResolver();
    const resolver = new Resolver(this, name, range);
    try {
      return await resolver.resolve();
    } catch (err) {
      // if it is not an error thrown by yarn and it has a parent request,
      // thow a more readable error
      if (
        !(err instanceof MessageError) &&
        this.parentRequest &&
        this.parentRequest.pattern
      ) {
        throw new MessageError(
          this.reporter.lang(
            "requiredPackageNotFoundRegistry",
            pattern,
            this.parentRequest.pattern,
            this.registry,
          ),
        );
      }
      throw err;
    }
  }

  /**
   * Get the registry resolver associated with this package request.
   */

  getRegistryResolver() {
    const Resolver = registryResolvers[this.registry];
    if (Resolver) {
      return Resolver;
    } else {
      throw new MessageError(
        this.reporter.lang("unknownRegistryResolver", this.registry),
      );
    }
  }

  async normalizeRange(pattern) {
    if (
      pattern.indexOf(":") > -1 ||
      pattern.indexOf("@") > -1 ||
      getExoticResolver(pattern)
    ) {
      return pattern;
    }

    if (!semver.validRange(pattern)) {
      try {
        if (
          await fs.exists(
            path.join(this.config.cwd, pattern, constants.NODE_PACKAGE_JSON),
          )
        ) {
          this.reporter.warn(
            this.reporter.lang("implicitFileDeprecated", pattern),
          );
          return `file:${pattern}`;
        }
      } catch (err) {
        // pass
      }
    }

    return pattern;
  }

  async normalize(pattern) {
    const { name, range, hasVersion } = normalizePattern(pattern);
    const newRange = await this.normalizeRange(range);
    return { name, range: newRange, hasVersion };
  }

  /**
   * Construct an exotic resolver instance with the input `ExoticResolver` and `range`.
   */

  findExoticVersionInfo(ExoticResolver, range) {
    const resolver = new ExoticResolver(this, range);
    return resolver.resolve();
  }

  /**
   * If the current pattern matches an exotic resolver then delegate to it or else try
   * the registry.
   */

  async findVersionInfo() {
    const exoticResolver = getExoticResolver(this.pattern);
    if (exoticResolver) {
      return this.findExoticVersionInfo(exoticResolver, this.pattern);
    } else if (
      WorkspaceResolver.isWorkspace(this.pattern, this.resolver.workspaceLayout)
    ) {
      invariant(this.resolver.workspaceLayout, "expected workspaceLayout");
      const resolver = new WorkspaceResolver(
        this,
        this.pattern,
        this.resolver.workspaceLayout,
      );
      let manifest;
      if (
        this.config.focus &&
        !this.pattern.includes(
          this.resolver.workspaceLayout.virtualManifestName,
        ) &&
        !this.pattern.startsWith(this.config.focusedWorkspaceName + "@")
      ) {
        const localInfo = this.resolver.workspaceLayout.getManifestByPattern(
          this.pattern,
        );
        invariant(localInfo, "expected local info for " + this.pattern);
        const localManifest = localInfo.manifest;
        const requestPattern = localManifest.name + "@" + localManifest.version;
        manifest = await this.findVersionOnRegistry(requestPattern);
      }
      return resolver.resolve(manifest);
    } else {
      return this.findVersionOnRegistry(this.pattern);
    }
  }

  reportResolvedRangeMatch(info, resolved) {}

  /**
   * Do the final resolve of a package that had a match with an existing version.
   * After all unique versions have been discovered, so the best available version
   * is found.
   */
  resolveToExistingVersion(info) {
    // get final resolved version
    const { range, name } = normalizePattern(this.pattern);
    const solvedRange = semver.validRange(range) ? info.version : range;
    const resolved = this.resolver.getHighestRangeVersionMatch(
      name,
      solvedRange,
      info,
    );
    invariant(resolved, "should have a resolved reference");

    this.reportResolvedRangeMatch(info, resolved);
    const ref = resolved._reference;
    invariant(ref, "Resolved package info has no package reference");
    ref.addRequest(this);
    ref.addPattern(this.pattern, resolved);
    ref.addOptional(this.optional);
  }

  /**
   * TODO description
   */
  async find({ fresh, frozen, extraDependencies }) {
    // find version info for this package pattern
    const info = await this.findVersionInfo();

    if (!semver.valid(info.version)) {
      throw new MessageError(
        this.reporter.lang("invalidPackageVersion", info.name, info.version),
      );
    }

    info.fresh = fresh;
    cleanDependencies(info, false, this.reporter, () => {
      // swallow warnings
    });

    // check if while we were resolving this dep we've already resolved one that satisfies
    // the same range
    const { range, name } = normalizePattern(this.pattern);
    const solvedRange = semver.validRange(range) ? info.version : range;
    const resolved =
      !info.fresh || frozen
        ? this.resolver.getExactVersionMatch(name, solvedRange, info)
        : this.resolver.getHighestRangeVersionMatch(name, solvedRange, info);

    if (resolved) {
      this.resolver.reportPackageWithExistingVersion(this, info);
      return;
    }

    if (info.flat && !this.resolver.flat) {
      throw new MessageError(
        this.reporter.lang("flatGlobalError", `${info.name}@${info.version}`),
      );
    }

    // validate version info
    PackageRequest.validateVersionInfo(info, this.reporter);

    //
    const remote = info._remote;
    invariant(remote, "Missing remote");

    // set package reference
    const ref = new PackageReference(this, info, remote);
    ref.addPattern(this.pattern, info);
    ref.addOptional(this.optional);
    ref.setFresh(fresh);
    info._reference = ref;
    info._remote = remote;
    // start installation of dependencies
    const promises = [];
    const deps = [];
    const parentNames = [...this.parentNames, name];

    let allPossibleDeps = { ...info.dependencies };
    if (Object.keys(extraDependencies || {}).includes(info.name)) {
      const candidates = extraDependencies[info.name] || {};
      Object.keys(candidates)
        .filter((range) => semver.satisfies(info.version, range))
        .forEach((c) => {
          allPossibleDeps = {
            ...(allPossibleDeps || {}),
            ...(candidates[c].dependencies || {}),
          };
        });
    }

    // normal deps
    for (const depName in allPossibleDeps) {
      const depPattern = depName + "@" + allPossibleDeps[depName];
      deps.push(depPattern);
      promises.push(
        this.resolver.find(
          {
            pattern: depPattern,
            registry: remote.registry,
            // dependencies of optional dependencies should themselves be optional
            optional: this.optional,
            parentRequest: this,
            parentNames,
          },
          extraDependencies,
        ),
      );
    }

    // optional deps
    for (const depName in info.optionalDependencies) {
      const depPattern = depName + "@" + info.optionalDependencies[depName];
      deps.push(depPattern);
      promises.push(
        this.resolver.find(
          {
            hint: "optional",
            pattern: depPattern,
            registry: remote.registry,
            optional: true,
            parentRequest: this,
            parentNames,
          },
          extraDependencies,
        ),
      );
    }
    if (remote.type === "workspace" && !this.config.production) {
      // workspaces support dev dependencies
      for (const depName in info.devDependencies) {
        const depPattern = depName + "@" + info.devDependencies[depName];
        deps.push(depPattern);
        promises.push(
          this.resolver.find(
            {
              hint: "dev",
              pattern: depPattern,
              registry: remote.registry,
              optional: false,
              parentRequest: this,
              parentNames,
            },
            extraDependencies,
          ),
        );
      }
    }

    if (this.activity && this.activity.addTotal) {
      this.activity.addTotal(promises.length);
    }

    for (const promise of promises) {
      await promise;
    }

    ref.addDependencies(deps);

    // Now that we have all dependencies, it's safe to propagate optional
    for (const otherRequest of ref.requests.slice(1)) {
      ref.addOptional(otherRequest.optional);
    }
  }

  /**
   * TODO description
   */

  static validateVersionInfo(info, reporter) {
    // human readable name to use in errors
    const human = `${info.name}@${info.version}`;

    info.version = PackageRequest.getPackageVersion(info);

    for (const key of constants.REQUIRED_PACKAGE_KEYS) {
      if (!info[key]) {
        throw new MessageError(
          reporter.lang("missingRequiredPackageKey", human, key),
        );
      }
    }
  }

  /**
   * Returns the package version if present, else defaults to the uid
   */

  static getPackageVersion(info) {
    // TODO possibly reconsider this behaviour
    return info.version === undefined ? info._uid : info.version;
  }

  /**
   * Gets all of the outdated packages and sorts them appropriately
   */

  static async getOutdatedPackages(
    lockfile,
    install,
    config,
    reporter,
    filterByPatterns,
    flags,
  ) {
    const { requests: reqPatterns, workspaceLayout } =
      await install.fetchRequestFromCwd();

    // Filter out workspace patterns if necessary
    let depReqPatterns = workspaceLayout
      ? reqPatterns.filter(
          (p) => !workspaceLayout.getManifestByPattern(p.pattern),
        )
      : reqPatterns;

    // filter the list down to just the packages requested.
    // prevents us from having to query the metadata for all packages.
    if (
      (filterByPatterns && filterByPatterns.length) ||
      (flags && flags.pattern)
    ) {
      const filterByNames =
        filterByPatterns && filterByPatterns.length
          ? filterByPatterns.map((pattern) => normalizePattern(pattern).name)
          : [];
      depReqPatterns = depReqPatterns.filter(
        (dep) =>
          filterByNames.indexOf(normalizePattern(dep.pattern).name) >= 0 ||
          (flags &&
            flags.pattern &&
            micromatch.contains(
              normalizePattern(dep.pattern).name,
              flags.pattern,
            )),
      );
    }

    const deps = await Promise.all(
      depReqPatterns.map(
        async ({ pattern, hint, workspaceName, workspaceLoc }) => {
          const locked = lockfile.getLocked(pattern);
          if (!locked) {
            throw new MessageError(reporter.lang("lockfileOutdated"));
          }

          const { name, version: current } = locked;
          let latest = "";
          let wanted = "";
          let url = "";

          const normalized = normalizePattern(pattern);

          if (
            getExoticResolver(pattern) ||
            getExoticResolver(normalized.range)
          ) {
            latest = wanted = "exotic";
            url = normalized.range;
          } else {
            const registry = config.registries[locked.registry];

            ({ latest, wanted, url } = await registry.checkOutdated(
              config,
              name,
              normalized.range,
            ));
          }

          return {
            name,
            current,
            wanted,
            latest,
            url,
            hint,
            range: normalized.range,
            upgradeTo: "",
            workspaceName: workspaceName || "",
            workspaceLoc: workspaceLoc || "",
          };
        },
      ),
    );

    // Make sure to always output `exotic` versions to be compatible with npm
    const isDepOld = ({ current, latest, wanted }) =>
      latest === "exotic" ||
      semver.lt(current, wanted) ||
      semver.lt(current, latest);
    const orderByName = (depA, depB) => depA.name.localeCompare(depB.name);
    return deps.filter(isDepOld).sort(orderByName);
  }
}
