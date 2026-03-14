#!/usr/bin/env node

import { Command } from "commander";
import { registerTicketCommand } from "./commands/ticket.js";

const program = new Command();

program
  .name("issues")
  .description("CLI client for the issues microservice")
  .version("0.0.1");

registerTicketCommand(program);

program.parse();
