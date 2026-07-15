import type { FastifyInstance } from "fastify";
import { translateText } from "../processor/translateText.js";
import { lookupText } from "../processor/lookupText.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ai/translate", async (request, reply) => {
    const body = (request.body ?? {}) as { text?: unknown; lang?: unknown };
    const result = await translateText(request.headers.authorization, { text: body.text, lang: body.lang });
    return reply.code(result.status).send(result.body);
  });

  app.post("/ai/lookup", async (request, reply) => {
    const body = (request.body ?? {}) as { text?: unknown; lang?: unknown };
    const result = await lookupText(request.headers.authorization, { text: body.text, lang: body.lang });
    return reply.code(result.status).send(result.body);
  });
}
