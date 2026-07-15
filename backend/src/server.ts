import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { registerRoutes } from "./portal/index.js";

// backend/src/server.ts -> the frontend's build output lives at ../frontend/build
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendBuildDir = path.resolve(here, "../../frontend/build");

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB raw upload cap; unpacked-size guard is separate
      files: 1
    }
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? "internal_error" : error.message });
  });

  await registerRoutes(app);

  // Serve the built frontend (SvelteKit adapter-static SPA) from the same
  // origin as the API, so both deploy as a single app. Only present when the
  // frontend has actually been built (deployment) - absent in local dev,
  // where the frontend instead runs on its own Vite dev server (see run.sh),
  // so this is a no-op there and 404s stay plain JSON as before.
  if (existsSync(frontendBuildDir)) {
    await app.register(fastifyStatic, { root: frontendBuildDir, wildcard: false });

    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET") {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      reply.sendFile("index.html", frontendBuildDir);
    });
  }

  return app;
}
