import path from "path";
import { readJson } from "./readJson.js";

export const scalekitConfigPath = "./scalekit.json";

const toolsPath = path.join(process.cwd(), scalekitConfigPath);

/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} version
 * @property {string} registry
 */

/**
 * @type {{ toolsDir: string; tools: Tool[]; registries: { [key: string]: string }}}
 */
const config = (await readJson(toolsPath));
config.toolsDir = config.toolsDir || "./.tools";
export const scalekitConfig = config;