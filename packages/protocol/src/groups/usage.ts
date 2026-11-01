import { Location } from "@olive/schema/location"
import { UsageLimits } from "@olive/schema/usage-limits"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const UsageGroup = HttpApiGroup.make("server.usage")
  .add(
    HttpApiEndpoint.get("usage.limits", "/api/experimental/usage/limits", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(UsageLimits.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.limits",
          summary: "Get usage limits",
          description:
            "Return the Olive Go allowance and Console budgets of the Olive Console workspace the location is signed in to, or null when it isn't signed in.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "usage",
      description: "Experimental usage limit routes.",
    }),
  )
