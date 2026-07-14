import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { registerRoutes } from "./portal/index.js";

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

  return app;
}
