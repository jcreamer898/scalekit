import { getPackageVersions } from "./ado/getPackageVersions.js";
import { parseArgs } from "util";
import { getPackageTarball } from "./getPackageTarball.js";
import assert from "assert";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    organization: { type: "string" },
    project: { type: "string" },
    feed: { type: "string" },
    destination: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    registry: { type: "string" },
  },
  allowPositionals: true,
});

const [subcommand, ...args] = positionals;
const { organization, project, feed, destination, version, registry } = values;

switch (subcommand) {
  /**
   * @example
   * get-version @scalekit/artifacts
   */
  case "get-version": {
    const [name] = args;

    assert(name, "Name must be specified");
    assert(organization, "Organization must be specified");
    assert(project, "Project must be specified");
    assert(feed, "Feed must be specified");

    const version = await getPackageVersions({
      name,
      organization,
      project,
      feed,
    });
    console.log(`Package ${name} is at ${version}.`);
    break;
  }
  /**
   * @example
   * get-tarball --name @scalekit/artifacts --version 1.0.0 --destination ./artifacts --registry https://registry.npmjs.org
   */
  case "get-tarball": {
    const { name } = values;

    assert(name, "Name must be specified");
    assert(version, "Version must be specified");
    assert(destination, "Destination must be specified");
    assert(registry, "Registry must be specified");

    const { files } = await getPackageTarball({
      name,
      version,
      destination,
      registry,
    });
    
    console.log(`${name} contained ${files.length} files, and was extracted to: ${destination}`);
    break;
  }
  default:
    console.log("No command specified");
}
