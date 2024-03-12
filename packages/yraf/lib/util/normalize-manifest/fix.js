import { MANIFEST_FIELDS } from "../../constants";

import { isValidBin, isValidLicense } from "./util.js";
import { normalizePerson } from "./util.js";
import { hostedGitFragmentToGitUrl } from "../../resolvers/index.js";
import inferLicense from "./infer-license.js";
import * as fs from "../fs.js";

const semver = require("semver");
const path = require("path");
const url = require("url");

const VALID_BIN_KEYS = /^(?!\.{0,2}$)[a-z0-9._-]+$/i;

const LICENSE_RENAMES = {
  "MIT/X11": "MIT",
  X11: "MIT",
};

export default (async function (info, moduleLoc, reporter, warn, looseSemver) {
  // clean info.version
  if (typeof info.version === "string") {
    info.version = semver.clean(info.version, looseSemver) || info.version;
  }

  // if name or version aren't set then set them to empty strings
  info.name = info.name || "";
  info.version = info.version || "";

  // support array of engine keys
  if (Array.isArray(info.engines)) {
    const engines = {};
    for (const str of info.engines) {
      if (typeof str === "string") {
        const [name, ...patternParts] = str.trim().split(/ +/g);
        engines[name] = patternParts.join(" ");
      }
    }
    info.engines = engines;
  }

  // if the `bin` field is as string then expand it to an object with a single property
  // based on the original `bin` field and `name field`
  // { name: "foo", bin: "cli.js" } -> { name: "foo", bin: { foo: "cli.js" } }
  if (
    typeof info.name === "string" &&
    typeof info.bin === "string" &&
    info.bin.length > 0
  ) {
    // Remove scoped package name for consistency with NPM's bin field fixing behaviour
    const name = info.name.replace(/^@[^\/]+\//, "");
    info.bin = { [name]: info.bin };
  }

  // bundleDependencies is an alias for bundledDependencies
  if (info.bundledDependencies) {
    info.bundleDependencies = info.bundledDependencies;
    delete info.bundledDependencies;
  }

  let scripts;

  // dummy script object to shove file inferred scripts onto
  if (info.scripts && typeof info.scripts === "object") {
    scripts = info.scripts;
  } else {
    scripts = {};
  }

  // set scripts if we've polluted the empty object
  if (Object.keys(scripts).length) {
    info.scripts = scripts;
  }

  for (const dependencyType of MANIFEST_FIELDS) {
    const dependencyList = info[dependencyType];
    if (dependencyList && typeof dependencyList === "object") {
      delete dependencyList["//"];
      for (const name in dependencyList) {
        dependencyList[name] = dependencyList[name] || "";
      }
    }
  }
});
