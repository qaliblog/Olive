import type { OliveClient, OliveEvent } from "@olive/client"
import { createClientConnection, createPersistentPtyClient } from "@olive/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { createMediaCache } from "../util/media"
import { useLog } from "./log"

type ManagedService = {
  reconnect: (signal: AbortSignal) => Promise<{ api: OliveClient; url?: string; headers?: Record<string, string> }>
  restart: () => Promise<void>
}

type ClientEventMap = { [Type in OliveEvent["type"]]: Extract<OliveEvent, { type: Type }> }

export const {
  use: useClient,
  provider: ClientProvider,
  context: ClientContext,
} = createSimpleContext({
  name: "Client",
  init: (props: { api: OliveClient; url?: string; headers?: Record<string, string>; service?: ManagedService }) => {
    const log = useLog({ component: "client" })
    const service = props.service
    const events = createGlobalEmitter<ClientEventMap>()
    let api = props.api
    let url = props.url
    let headers = props.headers
    let persistentPty = url ? createPersistentPtyClient(api, { url }) : undefined
    const media = createMediaCache(() => api)

    const connection = createClientConnection(api, {
      reconnect: service
        ? async (signal) => {
            const next = await service.reconnect(signal)
            api = next.api
            if (next.url) url = next.url
            headers = next.headers
            if (url) persistentPty = createPersistentPtyClient(api, { url })
            return api
          }
        : undefined,
      onEvent(event) {
        events.emit(event.type, event)
      },
      log,
    })

    onCleanup(() => {
      events.clear()
    })

    return {
      get api() {
        return api
      },
      get url() {
        return url
      },
      get headers() {
        return headers
      },
      get persistentPty() {
        if (!persistentPty) throw new Error("Persistent terminal server endpoint is unavailable")
        return persistentPty
      },
      event: {
        on: events.on,
        listen: events.listen,
      },
      connection,
      media,
      restart: service?.restart,
    }
  },
})
