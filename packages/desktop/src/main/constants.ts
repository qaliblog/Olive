import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OLIVE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OLIVE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "Olive Dev",
  beta: "Olive Beta",
  prod: "Olive",
}

const appIDs: Record<string, string> = {
  dev: "ai.olive.desktop.dev",
  beta: "ai.olive.desktop.beta",
  prod: "ai.olive.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "Olive Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.olive.desktop.dev"
