import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { statusHandler } from "./game/status";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// Game server status for site widgets — must precede the /api/* 404 catcher.
app.get("/api/status", statusHandler);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { attachGameGateway } = await import("./game/gateway");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  // Authoritative WS gateway on the same HTTP server at /ws.
  attachGameGateway(server as unknown as import("node:http").Server);
}

// Dev mode (vite middleware via @hono/vite-dev-server): the app module has no
// handle to the dev http server, so the WS gateway cannot be attached here.
// Production above is unaffected; in dev the client's 3s reconnect retry loop
// (contracts/netcode.ts) simply keeps retrying /ws.

