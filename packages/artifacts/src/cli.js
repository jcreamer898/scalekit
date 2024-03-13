import { getPackageVersions, getPackageVersion } from "./ado/getPackageVersions.js";
import { parseArgs } from "util";
import { getPackageTarball } from "./getPackageTarball.js";
import assert from "assert";
import { cyan, green } from "./colors.js";

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
const { organization, project, feed, destination, version: cliVersionArg, registry } = values;

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

    const { version, build } = await getPackageVersion({
      name,
      organization,
      project,
      feed,
      version: cliVersionArg,
    });
    console.log(`Package ${green(name)} is at ${cyan(version)}.`);
    console.log("")
    console.log("Below is the build information:")
    Object.entries(build).forEach(([key, value]) => {
      console.log(`${green(key)}: ${cyan(value)}`);
    })
    break;
  }
  case "get-versions": {
    const [name] = args;

    assert(name, "Name must be specified");
    assert(organization, "Organization must be specified");
    assert(project, "Project must be specified");
    assert(feed, "Feed must be specified");
    
    /** @type {import("./ado/getPackageVersions.js").VersionsReponse} */
    const { versions } = await getPackageVersions({
      name,
      organization,
      project,
      feed,
    });

    console.log(`Top ${versions.length} of ${name}:`)
    versions.forEach((version) => {
      const date = new Date(version.publishDate);
      console.log(`${green(version.version)} published on ${cyan(date.toUTCString())}`);
    })
    break;
  }
  /**
   * @example
   * get-tarball --name @scalekit/artifacts --version 1.0.0 --destination ./artifacts --registry https://registry.npmjs.org
   */
  case "get-tarball": {
    const { name } = values;

    assert(name, "Name must be specified");
    assert(cliVersionArg, "Version must be specified");
    assert(destination, "Destination must be specified");
    assert(registry, "Registry must be specified");

    const { files } = await getPackageTarball({
      name,
      version: cliVersionArg,
      destination,
      registry,
    });
    
    console.log(`${name} contained ${files.length} files, and was extracted to: ${destination}`);
    break;
  }
  default:
    console.log("No command specified");
}
