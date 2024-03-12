import PQueue from "p-queue";

import { MessageError, SecurityError } from "./errors.js";
import * as fetchers from "./fetchers/index.js";
import * as fs from "./util/fs.js";
import * as promise from "./util/promise.js";
import { reportProgress } from "./reporters/report-progress.js";

const ssri = require("ssri");

async function fetchCache(dest, fetcher, config, remote) {
  // $FlowFixMe: This error doesn't make sense
  const {
    hash,
    files,
    buffer,
    package: pkg,
    remote: cacheRemote,
  } = await config.readPackageMetadata(dest);

  const cacheIntegrity = cacheRemote.cacheIntegrity || cacheRemote.integrity;
  const cacheHash = cacheRemote.hash;

  if (remote.integrity) {
    if (!cacheIntegrity) {
      throw new SecurityError(
        config.reporter.lang(
          "fetchBadIntegrityCache",
          pkg.name,
          cacheIntegrity,
          remote.integrity
        )
      );
    } else if (!ssri.parse(cacheIntegrity).match(remote.integrity)) {
      const remoteAlgo = /^([^-]*)-/.exec(remote.integrity)[1];
      const cacheAlgo = /^([^-]*)-/.exec(cacheIntegrity)[1];
      if (remoteAlgo === cacheAlgo) {
        throw new SecurityError(
          config.reporter.lang(
            "fetchBadIntegrityCache",
            pkg.name,
            cacheIntegrity,
            remote.integrity
          )
        );
      } else {
        // We cannot validate the cache integrity because it uses a different algo than the remote.
      }
    }
  }

  if (remote.hash) {
    if (!cacheHash || cacheHash !== remote.hash) {
      throw new SecurityError(
        config.reporter.lang(
          "fetchBadHashCache",
          pkg.name,
          cacheHash,
          remote.hash
        )
      );
    }
  }

  return {
    package: pkg,
    hash,
    dest,
    files,
    buffer,
    cached: true,
  };
}

export async function fetchOneRemote(remote, name, version, dest, config) {
  // Mock metadata for symlinked dependencies
  if (remote.type === "link") {
    const mockPkg = { _uid: "", name: "", version: "0.0.0" };
    return Promise.resolve({
      resolved: null,
      hash: "",
      dest,
      package: mockPkg,
      cached: false,
    });
  }

  const Fetcher = fetchers[remote.type];
  if (!Fetcher) {
    throw new MessageError(
      config.reporter.lang("unknownFetcherFor", remote.type)
    );
  }

  const fetcher = new Fetcher(dest, remote, config);
  if (await config.isValidModuleDest(dest)) {
    return fetchCache(dest, fetcher, config, remote);
  }

  return await fetcher.fetch({
    name,
    version,
  });
}

function fetchOne(ref, config) {
  const dest = config.generateModuleCachePath(ref);

  return fetchOneRemote(ref.remote, ref.name, ref.version, dest, config);
}

async function maybeFetchOne(ref, config) {
  try {
    return await fetchOne(ref, config);
  } catch (err) {
    if (ref.optional) {
      config.reporter.error(err.message);
      return null;
    } else {
      throw err;
    }
  }
}

export async function fetch(pkgs, config) {
  if (!process.env["YARN_MEMORY_CACHE"]) {
    const pkgsPerDest = new Map();
    pkgs = pkgs.filter((pkg) => {
      const ref = pkg._reference;
      if (!ref) {
        return false;
      }
      const dest = config.generateModuleCachePath(ref);
      const otherPkg = pkgsPerDest.get(dest);
      if (otherPkg) {
        // Another one that seems relatively meh
        // config.reporter.warn(
        //   config.reporter.lang(
        //     'multiplePackagesCantUnpackInSameDestination',
        //     ref.patterns,
        //     dest,
        //     otherPkg.patterns
        //   )
        // );
        return false;
      }
      pkgsPerDest.set(dest, ref);
      return true;
    });
  }

  const activity = config.reporter.activity("⬇️ Downloading", pkgs.length);

  const fetchPackage = (pkg) => async () => {
    const ref = pkg._reference;
    if (!ref) {
      activity.tick(pkg.name);
      result.push(pkg);
      return;
    }

    const res = await maybeFetchOne(ref, config);
    activity.tick(pkg.name);
    let newPkg;

    if (res) {
      newPkg = res.package;

      // update with new remote
      // but only if there was a hash previously as the tarball fetcher does not provide a hash.
      if (ref.remote.hash) {
        // if the checksum was updated, also update resolved and cache
        ref.remote.hash = res.hash || ref.remote.hash;
      }
    }

    if (newPkg) {
      newPkg._reference = ref;
      newPkg._remote = ref.remote;
      newPkg._files = res && res.files;
      newPkg._buffer = res && res.buffer;
      newPkg.name = pkg.name;
      newPkg.fresh = pkg.fresh;
      return result.push(newPkg);
    } else {
      return result.push(pkg);
    }
  };
  const queue = new PQueue({ concurrency: 1024 });
  const result = [];

  await Promise.all(pkgs.map((pkg) => queue.add(fetchPackage(pkg))));

  fetchers["tarball"].cleanup();
  // activity.end();

  return result;
}
