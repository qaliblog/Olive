import type { OliveEvent } from "@olive/client"
import type { SelectedEvent, SubscribeOptions } from "@olive/client/promise/api"

type EventType = Exclude<OliveEvent["type"], "server.connected">

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(
    options?: SubscribeOptions<Type>,
  ) => AsyncIterable<SelectedEvent<OliveEvent, Type>>
}
