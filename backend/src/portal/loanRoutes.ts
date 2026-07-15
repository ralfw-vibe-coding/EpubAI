import type { FastifyInstance } from "fastify";
import { borrowBook } from "../processor/borrowBook.js";
import { returnLoan } from "../processor/returnLoan.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  app.post("/loans", async (request, reply) => {
    const body = (request.body ?? {}) as { bookId?: unknown; deviceId?: unknown };
    const result = await borrowBook(request.headers.authorization, {
      bookId: body.bookId,
      deviceId: body.deviceId
    });
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { bookId: string } }>("/loans/:bookId", async (request, reply) => {
    const body = (request.body ?? {}) as { deviceId?: unknown };
    const result = await returnLoan(request.headers.authorization, {
      bookId: request.params.bookId,
      deviceId: body.deviceId
    });
    return reply.code(result.status).send(result.body);
  });
}
