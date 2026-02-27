import path from "path";
import { getPackageTarball } from "@scalekit/artifacts";
import { scalekitConfig } from "./config.js";

/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} version
 * @property {string} registry
 */

export const install = async () => {
  // Usage
  return await Promise.all([
    ...scalekitConfig.tools.map((tool) =>
      getPackageTarball({
        name: tool.name,
        version: tool.version,
        destination: scalekitConfig.toolsDir,
        registry:
          (scalekitConfig.registries && scalekitConfig.registries[tool.registry]) ||
          "https://registry.npmjs.org",
      }),
    ),
  ])
    .catch((error) => console.error(`An error occurred: ${error.message}`));
};
