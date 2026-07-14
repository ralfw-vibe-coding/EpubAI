import { env } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Failed to start server:", err instanceof Error ? err.message : err);
  process.exit(1);
});
