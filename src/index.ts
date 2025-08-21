import { DurableObject } from "cloudflare:workers";

export class MyDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // touch storage
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, message TEXT)"
    );
    // add one message
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (message) VALUES (?)",
      `Hello, world! Time is ${new Date().toISOString()}`
    );
  }
  fetch(_req: Request) {
    // Creates two ends of a WebSocket connection.
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Calling `acceptWebSocket()` connects the WebSocket to the Durable Object, allowing the WebSocket to send and receive messages.
    // Unlike `ws.accept()`, `state.acceptWebSocket(ws)` allows the Durable Object to be hibernated
    // When the Durable Object receives a message during Hibernation, it will run the `constructor` to be re-initialized
    this.ctx.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): void | Promise<void> {
    console.log("Received message:", message);
    ws.send("Hello, world back!\n");
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // assume incoming request returns a ReadableStream that implements SSE
    // connect to the durable object with a websocket

    let ws: WebSocket | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const id = env.MyDO.idFromName("some-name");
        const myDO = env.MyDO.get(id);
        const res = await myDO.fetch("http://example.com", {
          headers: {
            Upgrade: "websocket",
          },
        });
        ws = res.webSocket!;
        ws.accept();
        ws?.addEventListener("message", (event) => {
          controller.enqueue(encoder.encode(event.data));
        });
        let ctr = 10;
        const handle = setInterval(() => {
          if (ctr-- > 0) {
            ws!.send(`Hello, world! ${ctr}`);
          } else {
            clearInterval(handle);
            ws!.close();
            controller.close();
          }
        }, 1000);

        // controller.close();
      },
      cancel() {
        ws!.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  },
};
