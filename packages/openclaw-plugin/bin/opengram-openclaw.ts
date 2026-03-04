#!/usr/bin/env node

import { runFullSetup } from "../src/cli/run-setup.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "setup") {
  let baseUrl: string | undefined;
  let instanceSecret: string | undefined;
  let noInstanceSecret = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) {
      baseUrl = args[++i];
    } else if (args[i] === "--instance-secret" && args[i + 1]) {
      instanceSecret = args[++i];
    } else if (args[i] === "--no-instance-secret") {
      noInstanceSecret = true;
    }
  }

  runFullSetup({ baseUrl, instanceSecret, noInstanceSecret }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log("Usage: opengram-openclaw setup [options]");
  console.log("");
  console.log("Options:");
  console.log("  --base-url <url>          Pre-fill the OpenGram instance URL");
  console.log("  --instance-secret <s>     Pre-fill the instance secret");
  console.log("  --no-instance-secret      Specify that no instance secret is used");
  process.exit(command === "help" || command === "--help" || command === "-h" ? 0 : 1);
}
