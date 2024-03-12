import os from "os";
import path from "path";
import { constants } from "fs";
import { mkdir, writeFile, access, copyFile } from "fs/promises";
import humanId from "human-id";
import { Package } from "./types";
import { createPackageJson, createTsConfig, exec, remove } from "./utils";

const tmpMonorepoPrefix = "mr";

/**
 * Abstraction for a monorepo
 * Able to create the underlying monorepo filesystem and perform repo actions on it
 * Such as git operations, package manager operations, other repo tasks
 */
class Monorepo {
  private isSetup: boolean;
  private isVerbose: boolean;
  rootDir: string;
  packagesDir: string;
  externalPackagesDir: string;
  externalPackages: string[]; // list of external packages; must be unlinked on teardown

  constructor(isVerbose = false) {
    this.isSetup = false;
    this.isVerbose = isVerbose;
    this.rootDir = path.join(
      os.tmpdir(),
      tmpMonorepoPrefix +
        humanId({
          separator: "-",
          capitalize: false,
        })
    );
    this.packagesDir = path.join(this.rootDir, "packages");
    this.externalPackagesDir = path.join(
      os.tmpdir(),
      humanId({
        separator: "-",
        capitalize: false,
      }),
      "mock_external_packages"
    );
    this.externalPackages = [];
  }

  /**
   * Adds a package to the repo
   * @param { Package } pkg The package to be added
   */
  async addPackage(pkg: Package): Promise<void> {
    if (!this.isSetup) {
      throw new Error(
        "Monorepo must be setup before usage. Please call `.setup()` first"
      );
    }

    const { name } = pkg;

    const packageDir = path.join(this.packagesDir, name);

    await mkdir(packageDir, { recursive: true });
    await mkdir(path.join(packageDir, "src"), { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      createPackageJson(pkg)
    );

    // create tsconfig
    await writeFile(path.join(packageDir, "tsconfig.json"), createTsConfig());

    // create src directory and add index.ts
    const mainContents = [
      ...Object.keys(pkg.dependencies || {}).map(
        (s) => `import * as _${s.replace(/\-/g, "")} from "${s}";`
      ),
      `console.log('***** Package ${name} *****');`,
      `console.log('\tDependencies:');`,
      ...Object.keys(pkg.dependencies || {}).map(
        (s) => `console.log('\t\t-${s}');`
      ),
      `console.log('\tDevDependencies:');`,
      ...Object.keys(pkg.devDependencies || {}).map(
        (s) => `console.log('\t\t-${s}');`
      ),
      `console.log('\tPeerDependencies:')`,
      ...Object.keys(pkg.peerDependencies || {}).map(
        (s) => `console.log('\t\t-${s}');`
      ),
    ];
    await writeFile(
      path.join(packageDir, "src", "index.ts"),
      mainContents.join("\n")
    );
  }

  /**
   * Adds an external package to the repo
   * @param { Package } pkg
   */
  async createExternalPackage(pkg: Package): Promise<Package> {
    if (!this.isSetup) {
      throw new Error(
        "Monorepo must be setup before usage. Please call `.setup()` first"
      );
    }

    const { name } = pkg;

    const packageDir = path.join(this.externalPackagesDir, name);

    await mkdir(packageDir, { recursive: true });
    await mkdir(path.join(packageDir, "src"), { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      createPackageJson(pkg)
    );

    // create tsconfig
    await writeFile(
      path.join(packageDir, "tsconfig.json"),
      createTsConfig(true)
    );

    const mainContents = [
      "const main = () => {",
      `\tconsole.log('Package ${name}');`,
      `\tconsole.log('\tDependencies:');`,
      ...Object.keys(pkg.dependencies || {}).map(
        (s) => `\tconsole.log('\t\t-${s}');`
      ),
      `console.log('\tDevDependencies:');`,
      ...Object.keys(pkg.devDependencies || {}).map(
        (s) => `\tconsole.log('\t\t-${s}');`
      ),
      `console.log('\tPeerDependencies:')`,
      ...Object.keys(pkg.peerDependencies || {}).map(
        (s) => `\tconsole.log('\t\t-${s}');`
      ),
      "};",
      "",
      "export default main",
    ];
    await writeFile(
      path.join(packageDir, "src", "index.ts"),
      mainContents.join("\n")
    );
    await writeFile(path.join(packageDir, "index.js"), mainContents.join("\n"));
    const declarationContents = [
      "declare const main: () => void;",
      "export default main;",
    ];
    await writeFile(
      path.join(packageDir, "src", "index.d.ts"),
      declarationContents.join("\n")
    );

    pkg.location = packageDir;

    return pkg;
  }

  /**
   * Runs a command in the root of the repo
   * @param { string } cmd
   */
  async run(cmd: string) {
    if (!this.isSetup) {
      throw new Error(
        "Monorepo must be setup before usage. Please call `.setup()` first"
      );
    }

    return exec(cmd, { cwd: this.rootDir });
  }

  /**
   * Checks if a file exists in the repo at the given path
   * @param { string } path Path of the file to find
   * @returns { boolean } If the file is found
   */
  async exists(file: string): Promise<boolean> {
    if (!this.isSetup) {
      throw new Error(
        "Monorepo must be setup before usage. Please call `.setup()` first"
      );
    }

    try {
      await access(path.join(this.rootDir, file), constants.R_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Setup the repo
   * Should be called before other operations are used
   */
  async setup() {
    try {
      // ensure clean slate to start
      await this.teardown();
    } catch (error) {
      console.log("Failed to teardown on start");
    }

    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.packagesDir, { recursive: true });
    await writeFile(
      path.join(this.rootDir, "package.json"),
      createPackageJson({ name: "mr" }, true)
    );

    try {
      // copy midgard-yarn-strict to the temp dir
      await copyFile(
        path.join(__dirname, "../../dist/midgard-yarn-strict.bundle.js"),
        `${this.rootDir}/midgard-yarn-strict.bundle.js`
      );
    } catch (error) {
      console.error("Failed to copy midgard yarn strict to monorepo");
    }

    if (this.isVerbose) {
      console.log(`Setup repo at ${this.rootDir}`);
    }

    this.isSetup = true;
  }

  /**
   * Tear down the monorepo
   * Should be called once the repo is no longer being used
   */
  async teardown() {
    // clear external packages
    this.externalPackages = [];

    // remove monorepo
    await remove(this.rootDir);
    await remove(this.externalPackagesDir);

    if (this.isVerbose) {
      console.log(`Teardown repo at ${this.rootDir}`);
    }

    this.isSetup = false;
  }
}

export default Monorepo;
