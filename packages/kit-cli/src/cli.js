import { parseArgs } from "util";
import assert from "assert";
import ora from "ora"
import { install } from "./install.js";
import { run } from "./run.js";

const { values, positionals } = parseArgs({
  // Using 2,4 allows us to use the following commands:
  // yarn kit install
  // yarn kit run ado-tools
  // And everything else gets forwarded to the run command
  args: process.argv.slice(2, 4),
  allowPositionals: true,
});

const [subcommand, ...args] = positionals;
const { } = values;

switch (subcommand) {
  /**
   * @example
   * get-version @scalekit/artifacts
   */
  case "install": {
    const [] = args;

    // assert(name, "Name must be specified");
    const spinner = ora('Downloading tools.').start();
    const start = Date.now();
    const installed = await install();
    if (!installed || !installed.length) {
      spinner.stop();
      console.log("No tools installed.");
      break;
    }
    spinner.stop();
    for (const tool of installed) {
      console.log(`📦 Installed ${tool.name}@${tool.version}`);
    }
    const end = Date.now() - start;
    
    console.log(`Done in ${end}ms.`);
    break;
  }
  case "run" : {
    const [name] = args;
    await run(name);
    break;
  }
  default:
    console.log("No command specified");
}
