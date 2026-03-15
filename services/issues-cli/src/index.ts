#!/usr/bin/env node

import { Command } from "commander";
import { registerTicketCommand } from "./commands/ticket.js";
import { registerLabelCommand } from "./commands/label.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerAssignCommand } from "./commands/assign.js";
import { registerBlockCommand } from "./commands/block.js";
import { registerCommentCommand } from "./commands/comment.js";
import { registerAuthCommand } from "./commands/auth.js";

const program = new Command();

program
  .name("issues")
  .description("CLI client for the issues microservice")
  .version("0.0.1");

registerTicketCommand(program);
registerLabelCommand(program);
registerProjectCommand(program);
registerAssignCommand(program);
registerBlockCommand(program);
registerCommentCommand(program);
registerAuthCommand(program);

program.parse();
