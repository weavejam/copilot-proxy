#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { debug } from "./debug"
import { pricingSyncCmd } from "./pricing-sync-cmd"
import { start } from "./start"

const main = defineCommand({
  meta: {
    name: "copilot-api",
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: {
    auth,
    start,
    "check-usage": checkUsage,
    "pricing-sync": pricingSyncCmd,
    debug,
  },
})

await runMain(main)
