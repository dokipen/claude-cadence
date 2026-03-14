#!/usr/bin/env node

import { Command } from "commander";
import { registerTicketCommand } from "./commands/ticket.js";
import { registerLabelCommand } from "./commands/label.js";
import { registerAssignCommand } from "./commands/assign.js";

const program = new Command();

program
  .name("issues")
  .description("CLI client for the issues microservice")
  .version("0.0.1");

registerTicketCommand(program);
registerLabelCommand(program);
registerAssignCommand(program);

program.parse();
