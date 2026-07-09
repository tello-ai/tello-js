export type Handler<TEvent> = (event: TEvent) => void | Promise<void>;

export class EventEmitter<TEvent = unknown> {
  private readonly handlers = new Map<string, Handler<TEvent>[]>();

  on(eventType: string, handler: Handler<TEvent>): Handler<TEvent> {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);
    return handler;
  }

  off(eventType: string, handler: Handler<TEvent>): void {
    const handlers = this.handlers.get(eventType);
    if (!handlers) return;
    this.handlers.set(
      eventType,
      handlers.filter((item) => item !== handler),
    );
  }

  async emit(eventType: string, event: TEvent): Promise<void> {
    for (const handler of [...(this.handlers.get(eventType) ?? [])]) {
      await handler(event);
    }
  }
}
