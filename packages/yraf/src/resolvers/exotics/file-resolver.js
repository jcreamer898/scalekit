import path from "path";

import invariant from "invariant";
import * as uuid from "uuid";

import { MessageError } from "../../errors.js";
import ExoticResolver from "./exotic-resolver.js";
import * as util from "../../util/misc.js";
import * as fs from "../../util/fs.js";

export const FILE_PROTOCOL_PREFIX = "file:";

export default class FileResolver extends ExoticResolver {
  constructor(request, fragment) {
    super(request, fragment);
    this.loc = util.removePrefix(fragment, FILE_PROTOCOL_PREFIX);
  }

  static isVersion(pattern) {
    return (
      super.isVersion.call(this, pattern) ||
      this.prefixMatcher.test(pattern) ||
      path.isAbsolute(pattern)
    );
  }

  async resolve() {
    let loc = this.loc;
    if (!path.isAbsolute(loc)) {
      loc = path.resolve(this.config.lockfileFolder, loc);
    }

    if (this.config.linkFileDependencies) {
      const registry = "npm";
      const manifest = {
        _uid: "",
        name: "",
        version: "0.0.0",
        _registry: registry,
      };
      manifest._remote = {
        type: "link",
        registry,
        hash: null,
        reference: loc,
      };
      manifest._uid = manifest.version;
      return manifest;
    }
    if (!(await fs.exists(loc))) {
      throw new MessageError(
        this.reporter.lang("doesntExist", loc, this.pattern.split("@")[0]),
      );
    }

    const manifest = await (async () => {
      try {
        return await this.config.readManifest(loc, this.registry);
      } catch (e) {
        if (e.code === "ENOENT") {
          return {
            // This is just the default, it can be overridden with key of dependencies
            name: path.dirname(loc),
            version: "0.0.0",
            _uid: "0.0.0",
            _registry: "npm",
          };
        }

        throw e;
      }
    })();
    const registry = manifest._registry;
    invariant(registry, "expected registry");

    manifest._remote = {
      type: "copy",
      registry,
      hash: `${uuid.v4()}-${new Date().getTime()}`,
      reference: loc,
    };

    manifest._uid = manifest.version;

    return manifest;
  }
}
FileResolver.protocol = "file";
FileResolver.prefixMatcher = /^\.{1,2}\//;
