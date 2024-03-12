/* eslint no-unused-vars: 0 */

import normalizeManifest from "../util/normalize-manifest/index.js";
import * as constants from "../constants.js";
import * as fs from "../util/fs.js";
import lockMutex from "../util/mutex.js";

const path = require("path");

export default class BaseFetcher {
  constructor(dest, remote, config) {
    this.reporter = config.reporter;
    this.packageName = remote.packageName;
    this.reference = remote.reference;
    this.registry = remote.registry;
    this.hash = remote.hash;
    this.remote = remote;
    this.config = config;
    this.dest = dest;
  }

  setupMirrorFromCache() {
    // fetcher subclasses may use this to perform actions such as copying over a cached tarball to the offline
    // mirror etc
    return Promise.resolve();
  }

  _fetch() {
    return Promise.reject(new Error("Not implemented"));
  }

  async fetch(defaultManifest) {
    if (!process.env["YARN_MEMORY_CACHE"]) {
      await fs.mkdirp(this.dest);
    }

    // fetch package and get the hash
    const { hash, files, buffer } = await this._fetch();

    let pkg;

    if (files) {
      const pj = files.get("package.json");
      const content = Buffer.from(buffer, pj.offset, pj.size).toString("utf8");
      pkg = JSON.parse(content);
      normalizeManifest(pkg, this.dest, this.config, false);
    } else {
      pkg = await (async () => {
        // load the new normalized manifest
        try {
          return await this.config.readManifest(this.dest, this.registry);
        } catch (e) {
          if (e.code === "ENOENT" && defaultManifest) {
            return normalizeManifest(
              defaultManifest,
              this.dest,
              this.config,
              false,
            );
          } else {
            throw e;
          }
        }
      })();

      await fs.writeFile(
        path.join(this.dest, constants.METADATA_FILENAME),
        JSON.stringify(
          {
            manifest: pkg,
            artifacts: [],
            remote: this.remote,
            registry: this.registry,
            hash,
          },
          null,
          "  ",
        ),
      );
    }

    return {
      hash,
      buffer,
      files,
      dest: this.dest,
      package: pkg,
      cached: false,
    };
  }
}
