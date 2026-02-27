import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { readJson } from "./readJson.js";
import { scalekitConfig } from "./config.js";

/**
 *
 * @param {string} destination
 */
export const getToolsInDir = async (destination) => {
  const toolsDirs = await fs.readdir(destination, { withFileTypes: true});
  const toolPaths = [];

  for (const dir of toolsDirs) {
    if (!dir.isDirectory()) continue;

    if (dir.name.startsWith("@")) {
      const scopedDir = await fs.readdir(path.join(destination, dir.name));
      scopedDir.forEach((subDir) =>
        toolPaths.push(path.join(destination, dir.name, subDir)),
      );
    } else {
      toolPaths.push(path.join(destination, dir.name));
    }
  }

  const tools = new Map();
  for (const tool of toolPaths) {
    const pkg = await readJson(path.join(tool, "package.json"));
    tools.set(pkg.name, {
      path: tool,
      bins: pkg.bin
        ? typeof pkg.bin == "string"
          ? { [pkg.name.replace(/^@[^\/]+\//, "")]: path.resolve(tool, pkg.bin) }
          : Object.entries(pkg.bin).reduce((memo, [key, value]) => {
            memo[key] = path.resolve(tool, value);
            return memo;
          }, {})
        : {},
    });
  }

  return tools;
};


/**
 * 
 * @param {string} name 
 */
export const run = async (name) => {
  const tools = await getToolsInDir(scalekitConfig.toolsDir);
  
  const bins = new Map();
  
  for (const [, tool] of tools) {
    if (tool.bins) {
      Object.entries(tool.bins).forEach(([binName, binPath]) => {
        bins.set(binName, binPath);
        fs.chmod(binPath, "755")
      })
    }
  }
  const bin = bins.get(name);
  const argsAfter = 4
  const args = process.argv.slice(argsAfter); 
  
  await spawn(bin, args, {
    stdio: "inherit"
  });
};