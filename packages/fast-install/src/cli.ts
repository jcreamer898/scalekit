import { Command } from "./command";
import { Command as Commander } from "commander";
import { logger, Logger } from "./logger";
import * as install from "./commands/install";

interface CLIOptions {
  logger?: Logger;
}

export class CLI {
  command: Commander;
  context: any;
  defaults: CLIOptions = {
    logger,
  };
  options!: CLIOptions;
  commands: any[];

  constructor(command: Commander, opts?: CLIOptions) {
    this.command = command;
    this.options = { ...this.defaults, ...opts };
    this.commands = [install];
  }

  run() {
    for (const command of this.commands) {
      command.init(this.command, { logger: this.options.logger });
    }

    this.command.parse(process.argv);
  }
}
