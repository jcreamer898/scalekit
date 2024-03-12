import { Command as CommanderCommand } from "commander";
import { Logger } from "./logger.js";

export interface Command {
  (program: CommanderCommand, opts: { logger: Logger }): void;
}
