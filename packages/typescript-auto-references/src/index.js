#!/usr/bin/env node

import fs from "fs";
import path from "path";
import prettier from "prettier";
import ts from "typescript";
import fsAsync from "fs/promises";

/**
 * 
 * @param {string} name 
 * @param {string} from 
 * @returns 
 */
async function resolvePackage(name, from) {
  if (path.dirname(from) === from) {
      throw new Error(`Cannot resolve ${name} from ${from}.`);
  }

  const candidate = path.join(from, "node_modules", name);
  try {
      await fsAsync.stat(candidate);
      const result = await fsAsync.realpath(candidate);
      return result;
  } catch {
      try {
          return await resolvePackage(name, path.dirname(from));
      } catch {
          throw new Error(`Cannot resolve ${name} from ${from}.`);
      }
  }
}

/**
 * The reads a TypeScript project file and returns
 * a json representation of it. The advantage over
 * standard json parsing is that it allows comments
 * in the content of the file.
 * @param {string} file
 */
export function readTsConfig(file) {
  const result = ts.readConfigFile(file, ts.sys.readFile);

  if (result.error || !result.config) {
    throw new Error(
      `Failed to read ${file}: ${
        result.error ? result.error.messageText : "Empty content"
      }`
    );
  }

  return result.config;
}

/**
 * @typedef {Object} ParsedTsConfig
 * @property {ts.CompilerOptions} compilerOptions
 * @property {string[]} [fileNames]
 */

/**
 * 
 * @param {string} tsConfigContent 
 * @param {string} dirname 
 * @returns {ParsedTsConfig}
 */
export function parseTsConfigContent(
  tsConfigContent,
  dirname
) {
  /**
   * @type {import("typescript").ParseConfigHost}
   */
  const parseConfigHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    useCaseSensitiveFileNames: true,
  };

  /*
   * This function flattens the nested configs,
   * validates the compiler options and resolve
   * the files to compile.
   */
  const result = ts.parseJsonConfigFileContent(
    tsConfigContent,
    parseConfigHost,
    dirname
  );

  if (result.errors.length > 0) {
    throw new Error(
      `Failed to parse ts config: ${result.errors
        .map((e) => e.messageText)
        .join(", ")}`
    );
  }

  const { options: compilerOptions, fileNames } = result;
  return { compilerOptions, fileNames };
}

/**
 * 
 * @param {string} file 
 * @returns {ts.CompilerOptions}
 */
export function getCompilerOptions(file) {
  const config = readTsConfig(file);

  const { compilerOptions } = parseTsConfigContent(config, path.dirname(file));

  return compilerOptions;
}

/**
 * 
 * @param {string} location 
 * @returns 
 */
function isWorkspaceDependency(location) {
  return location.indexOf("node_modules") === -1;
}

/**
 * 
 * @param {string} location 
 * @returns 
 */
async function isCompositePackage(location) {
  try {
    const config = (await import(path.join(location, "tsconfig.json"), { assert: { type: "json" } })).default;
    return config.compilerOptions && config.compilerOptions.composite;
  } catch {
    return false;
  }
}

/**
 * @param {string} l 
 * @returns 
 */
async function getPackageDirectDependenciesNames(l) {
  const packageJson = (await import(path.join(l, "package.json"),  { assert: { type: "json" } })).default;
  const dependencies = Object.keys(packageJson.dependencies || []);
  const devDependencies = Object.keys(packageJson.devDependencies || []);
  const uniqueDependencies = [
    ...new Set([...devDependencies, ...dependencies]),
  ];
  return uniqueDependencies;
}

const resolvedPackages = new Map();
/**
 * 
 * @param {string} name 
 * @param {string} loc
 * @returns 
 */
async function resolvePackageMemo(name, loc) {
  if (resolvedPackages.has(name)) {
    return resolvedPackages.get(name);
  }
  const result = await resolvePackage(name, loc);
  resolvedPackages.set(name, result);
  return result;
}

/**
 * 
 * @param {string} loc
 * @returns 
 */
async function getPackageDirectDependencies(loc) {
  return await Promise.all(
    (await getPackageDirectDependenciesNames(loc)).map(async (name) => {
      const location = await resolvePackageMemo(name, loc);
      return { location, name };
    })
  );
}

/**
 * 
 * @param {string} loc
 * @returns 
 */
async function getTsPackageDependencies(loc) {
  const pkgDeps = (await getPackageDirectDependencies(loc));
  const TsDependencies = [];
  for (const p of pkgDeps) {
    const isComposite = await isCompositePackage(p.location);
    const isWsDep = isWorkspaceDependency(p.location);

    if (isComposite && isWsDep) {
      TsDependencies.push(p)
    }
  }

  return TsDependencies.sort((a, b) => a.location.localeCompare(b.location));
}

/**
 * 
 * @param {string} loc
 * @returns 
 */
async function shouldPackageUseStrictTypes(loc) {
  const packageJson = (await import(path.join(loc, "package.json"),  { assert: { type: "json" } } )).default;
  return (
    typeof packageJson.strictTypes === "undefined" ||
    packageJson.strictTypes === true
  );
}

/**
 * 
 * @param {string} loc
 * @returns 
 */
async function getTypesForPackage(loc) {
  const packageJson = (await import(path.join(loc, "package.json"),  { assert: { type: "json" } })).default;
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const deps = Object.keys({ ...dependencies, ...devDependencies });
  const result = deps
    .filter((k) => k.match(/^@types\//))
    .map((k) => k.replace("@types/", ""));
  return result.sort();
}

/**
 * 
 * @param {string} cwd
 * @returns 
 */
export async function updateTsConfig(cwd) {
  const tsconfigFilePath = path.join(cwd, "tsconfig.json");
  
  if (!fs.existsSync(tsconfigFilePath)) {
    return;
  }

  /**
   * @type {{ compilerOptions: import("typescript").CompilerOptions; references?: import("typescript").ProjectReference[]; }} 
   */
  let tsconfig = {};

  try {
    tsconfig = readTsConfig(tsconfigFilePath);
  } catch (err) {
    console.error(`Error reading ${tsconfigFilePath}: ${err.message}`);
    process.exit(1);
  }
  try {
    // Verify that the tsconfig.json file can also be parsed using JSON.parse() or it
    // can cause issues in other parts of the build process (such as in midgard-scripts build).
    JSON.parse(fs.readFileSync(tsconfigFilePath).toString());
  } catch (err) {
    console.error(`Error JSON-parsing ${tsconfigFilePath}: ${err.message}`);
    process.exit(1);
  }
  let changed = false;
  if (
    tsconfig.compilerOptions.composite !== false &&
    tsconfig.compilerOptions.composite !== true
  ) {
    changed = true;
    tsconfig.compilerOptions.composite = true;
  }

  if (await shouldPackageUseStrictTypes(cwd)) {
    let oldTypes = tsconfig.compilerOptions.types || [];
    let newTypes = await getTypesForPackage(cwd);
    let areSame = oldTypes.length === newTypes.length;
    if (areSame) {
      for (let i = 0; i < newTypes.length; i++) {
        if (newTypes[i] !== oldTypes[i]) {
          areSame = false;
          break;
        }
      }
    }
    if (!areSame) {
      changed = true;
      tsconfig.compilerOptions.types = newTypes;
    }
  }

  const newReferences = (await getTsPackageDependencies(cwd)).map((p) => ({
    path: path
      .relative(cwd, path.join(p.location, "tsconfig.json"))
      .replace(/\\/g, "/"),
  }));
  // console.log({ newReferences })

  if (!newReferences || newReferences.length === 0) {
    if (tsconfig.references !== undefined) {
      changed = true;
      delete tsconfig.references;
    }
  } else {
    const expectedReference = [
      {
        path: "./tsconfig.references.json",
      },
    ];

    if (
      JSON.stringify(tsconfig.references) !== JSON.stringify(expectedReference)
    ) {
      tsconfig.references = expectedReference;
      changed = true;
    }
    await updateReferencesTsConfig(tsconfig, newReferences, cwd);
  }

  if (changed) {
    const formattedConfig = await prettier.format(JSON.stringify(tsconfig), {
      parser: "json",
    });
    fs.writeFileSync(`${cwd}/tsconfig.json`, formattedConfig);
  }

  return changed;
}

/**
 * 
 * @param {ParsedTsConfig} tsconfig 
 * @param {import("typescript").ProjectReference[]} newReferences 
 * @param {string} cwd 
 */
async function updateReferencesTsConfig(tsconfig, newReferences, cwd) {
  try {
    const initialConfig = {
      compilerOptions: {
        composite: true,
        outDir: tsconfig.compilerOptions.outDir,
        rootDir: tsconfig.compilerOptions.rootDir,
      },
      files: [],
      references: newReferences,
    };
    const formattedConfig = await prettier.format(
      JSON.stringify(initialConfig),
      {
        parser: "json",
      }
    );
    const referencesTsconfigFilePath = path.join(
      cwd,
      "tsconfig.references.json"
    );
    await fs.promises.writeFile(referencesTsconfigFilePath, formattedConfig);
  } catch (error) {
    console.error("Error creating tsconfig.references.json:", error);
    process.exit(1);
  }
}


