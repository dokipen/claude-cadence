#!/usr/bin/env node

// Trust macOS Keychain certificates (e.g. Caddy internal CA)
if (process.platform === "darwin") {
  try {
    await import("mac-ca/register");
  } catch (e) {
    process.stderr.write(`warning: failed to load macOS Keychain certs: ${e}\n`);
  }
}

import { Command } from "commander";
import { registerTicketCommand } from "./commands/ticket.js";
import { registerLabelCommand } from "./commands/label.js";
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
registerAssignCommand(program);
registerBlockCommand(program);
registerCommentCommand(program);
registerAuthCommand(program);

program.parse();
