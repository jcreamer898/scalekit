import { exec as childProcessExec } from "child_process";
import rimraf from "rimraf";
import { Package } from "./types";

export const createPackageJson = (pkg: Package, isRoot?: boolean): string => {
  const {
    name,
    dependencies = {},
    peerDependencies = {},
    devDependencies = {},
    version = "1.0.0",
  } = pkg;

  return JSON.stringify(
    {
      name,
      version: version,
      private: true,
      workspaces: isRoot ? ["packages/*"] : undefined,
      scripts: {
        start: "node index.js",
        build: isRoot ? "lerna run build" : "tsc",
        strict: isRoot ? "node midgard-yarn-strict.bundle.js" : undefined,
        clean: "rm -rf node_modules",
        // TODO add more scripts here
        // ie. test, etc to cover all npm verbs
      },
      dependencies: {
        ...dependencies,
        typescript: "^4.1.5",
      },
      devDependencies,
      peerDependencies,
    },
    null,
    4
  );
};

export const createTsConfig = (isExternal = false) => {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "es5",
        module: "esnext",
        jsx: "react",
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        experimentalDecorators: true,
        noEmitOnError: true,
        moduleResolution: "node",
        strict: true,
        noFallthroughCasesInSwitch: true,
        noImplicitReturns: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        importHelpers: true,
        outDir: isExternal ? "." : "lib/",
        incremental: true,
        esModuleInterop: isExternal,
      },
      include: ["src"],
      exclude: [],
    },
    null,
    4
  );
};

export const createLernaJson = () => {
  return JSON.stringify({
    packages: ["packages/*"],
    npmClient: "yarn",
    useWorkspaces: true,
    version: "0.0.0",
  });
};

export const exec = async (
  cmd: string,
  options?: any
): Promise<{ error?: any; stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const childProcess = childProcessExec(cmd, options);

    let error = null,
      stdout = "",
      stderr = "";

    childProcess.on("exit", (code) => {
      if (code != 0) {
        error = new Error(`Command failed with code '${code}'`);
        return reject({ error, stdout, stderr });
      }
      resolve({ error, stdout, stderr });
    });
    childProcess.stdout.on("data", (data) => {
      stdout += data;
    });
    childProcess.stderr.on("data", (data) => {
      stderr += data;
    });
  });
};

export const remove = async (path: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    rimraf(path, (error) => {
      if (error) {
        return reject(error);
      }

      return resolve();
    });
  });
};
