import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./authRoutes.js";
import { registerBookRoutes } from "./bookRoutes.js";
import { registerLoanRoutes } from "./loanRoutes.js";
import { registerAnnotationRoutes } from "./annotationRoutes.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerAuthRoutes(app);
  await registerBookRoutes(app);
  await registerLoanRoutes(app);
  await registerAnnotationRoutes(app);
}
