import type { FastifyInstance } from "fastify";
import { borrowBook } from "../processor/borrowBook.js";
import { returnLoan } from "../processor/returnLoan.js";
import { listLoans } from "../processor/listLoans.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { deviceId?: string } }>("/loans", async (request, reply) => {
    const result = await listLoans(request.headers.authorization, {
      deviceId: request.query.deviceId
    });
    return reply.code(result.status).send(result.body);
  });

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
