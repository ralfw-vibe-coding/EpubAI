import type { FastifyInstance } from "fastify";
import { updateAccountSettings } from "../processor/updateAccountSettings.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/account", async (request, reply) => {
    const body = (request.body ?? {}) as { translationLanguage?: unknown; defaultFlashcardColor?: unknown };
    const result = await updateAccountSettings(request.headers.authorization, {
      translationLanguage: body.translationLanguage,
      defaultFlashcardColor: body.defaultFlashcardColor
    });
    return reply.code(result.status).send(result.body);
  });
}
