#!/usr/bin/env bun
import { Command } from "commander";
import { scanCommand } from "./commands/scan";
import { pushCommand } from "./commands/push";
import { pullCommand } from "./commands/pull";
import { listCommand } from "./commands/list";
import { syncCommand } from "./commands/sync";
import { setupCommand } from "./commands/setup";
import pkg from "../package.json";

declare const __GIT_COMMIT__: string;

const program = new Command();

program
  .name("shipkey")
  .description("Manage developer API keys securely")
  .version(`${pkg.version} (${typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "dev"})`);

program.addCommand(scanCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);
program.addCommand(listCommand);
program.addCommand(syncCommand);
program.addCommand(setupCommand);

program.parse();
