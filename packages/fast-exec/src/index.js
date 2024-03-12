import path from "path";
import { getPackageTarball } from "@scalekit/artifacts";

/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} version
 * @property {string} registry
 */

const toolsPath = path.join(process.cwd(), "./.tools/config.json");

/**
 * @type {{ tools: Tool[]; registries: { [key: string]: string }}
 */
const config = (await import(toolsPath, { assert: { type: "json" } })).default;
console.log(config)

// Usage
Promise.all([
  ...config.tools.map((tool) =>
    getPackageTarball({
      name: tool.name,
      version: tool.version,
      destination: "./.tools",
      registry: config.registries[tool.registry],
    }),
  ),
])
  .then(() => console.log("Download and extraction complete"))
  .catch((error) => console.error(`An error occurred: ${error.message}`));
