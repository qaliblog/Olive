import type { OliveEvent } from "@olive/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type OliveEventMap = { [Type in OliveEvent["type"]]: Extract<OliveEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: OliveEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends OliveEvent["type"]>(
    type: T,
    handler: (event: OliveEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory })
    })
  }

  return {
    subscribe,
    on,
  }
}
