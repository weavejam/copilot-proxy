import { Hono } from "hono"

import { defaultAccount } from "~/lib/state"

export const tokenRoute = new Hono()

tokenRoute.get("/", (c) => {
  try {
    const account = defaultAccount()
    return c.json({
      token: account?.copilotToken ?? null,
    })
  } catch (error) {
    console.error("Error fetching token:", error)
    return c.json({ error: "Failed to fetch token", token: null }, 500)
  }
})
