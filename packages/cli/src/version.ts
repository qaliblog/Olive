import { Option, Schema } from "effect"

declare const OLIVE_VERSION: string
declare const OLIVE_CHANNEL: string
declare const OLIVE_ARTIFACT: string
declare const OLIVE_RELEASE_HIGHLIGHTS: string

const version = typeof OLIVE_VERSION === "string" ? OLIVE_VERSION : "local"
const channel = typeof OLIVE_CHANNEL === "string" ? OLIVE_CHANNEL : "local"
const artifact = typeof OLIVE_ARTIFACT === "string" ? OLIVE_ARTIFACT : "cli"
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof OLIVE_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(OLIVE_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as OLIVE_VERSION,
  channel as OLIVE_CHANNEL,
  artifact as OLIVE_ARTIFACT,
  highlights as OLIVE_HIGHLIGHTS,
}
export const OLIVE_LOCAL = channel === "local"
