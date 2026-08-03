import type { FastifyInstance } from "fastify";
import { listReadingProgress } from "../processor/listReadingProgress.js";
import { saveReadingProgress } from "../processor/saveReadingProgress.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
//
// Note: every handler below returns `reply...send(...)` rather than calling
// `reply.send(...)` without returning it - see bookRoutes.ts for why this
// matters in async Fastify handlers.
export async function registerReadingProgressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reading-progress", async (request, reply) => {
    const result = await listReadingProgress(request.headers.authorization);
    return reply.code(result.status).send(result.body);
  });

  app.put<{ Params: { id: string } }>("/books/:id/reading-progress", async (request, reply) => {
    const body = (request.body ?? {}) as {
      cfi?: unknown;
      percent?: unknown;
      page?: unknown;
      totalPages?: unknown;
    };
    const result = await saveReadingProgress(request.headers.authorization, request.params.id, {
      cfi: body.cfi,
      percent: body.percent,
      page: body.page,
      totalPages: body.totalPages
    });
    return reply.code(result.status).send(result.body);
  });
}
