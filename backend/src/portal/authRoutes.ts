import type { FastifyInstance } from "fastify";
import { authRequestCode } from "../processor/authRequestCode.js";
import { authVerifyCode } from "../processor/authVerifyCode.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login/request", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: unknown };
    const result = await authRequestCode({ email: body.email });
    return reply.code(result.status).send(result.body);
  });

  app.post("/auth/login/verify", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: unknown; code?: unknown };
    const result = await authVerifyCode({ email: body.email, code: body.code });
    return reply.code(result.status).send(result.body);
  });
}
