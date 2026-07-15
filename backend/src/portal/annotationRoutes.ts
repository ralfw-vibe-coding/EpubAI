import type { FastifyInstance } from "fastify";
import { listAnnotations } from "../processor/listAnnotations.js";
import { createAnnotation } from "../processor/createAnnotation.js";
import { updateAnnotation } from "../processor/updateAnnotation.js";
import { deleteAnnotation } from "../processor/deleteAnnotation.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
//
// Note: every handler below returns `reply...send(...)` rather than calling
// `reply.send(...)` without returning it - see bookRoutes.ts for why this
// matters in async Fastify handlers.
export async function registerAnnotationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/annotations", async (request, reply) => {
    const result = await listAnnotations(request.headers.authorization);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>("/books/:id/annotations", async (request, reply) => {
    const body = (request.body ?? {}) as { cfiRange?: unknown; excerpt?: unknown; note?: unknown; color?: unknown };
    const result = await createAnnotation(request.headers.authorization, request.params.id, {
      cfiRange: body.cfiRange,
      excerpt: body.excerpt,
      note: body.note,
      color: body.color
    });
    return reply.code(result.status).send(result.body);
  });

  app.patch<{ Params: { id: string } }>("/annotations/:id", async (request, reply) => {
    const body = (request.body ?? {}) as { note?: unknown; color?: unknown };
    const result = await updateAnnotation(request.headers.authorization, request.params.id, {
      note: body.note,
      color: body.color
    });
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { id: string } }>("/annotations/:id", async (request, reply) => {
    const result = await deleteAnnotation(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });
}
