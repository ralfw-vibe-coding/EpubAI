import type { FastifyInstance } from "fastify";
import { listBooks } from "../processor/listBooks.js";
import { getBook } from "../processor/getBook.js";
import { updateBook } from "../processor/updateBook.js";
import { deleteBook } from "../processor/deleteBook.js";
import { uploadEpub } from "../processor/uploadEpub.js";
import { getBookFile } from "../processor/getBookFile.js";
import { uploadDossier } from "../processor/uploadDossier.js";
import { deleteDossier } from "../processor/deleteDossier.js";
import { archiveBook } from "../processor/archiveBook.js";
import { unarchiveBook } from "../processor/unarchiveBook.js";
import { exportAnnotations } from "../processor/exportAnnotations.js";
import { importAnnotations } from "../processor/importAnnotations.js";
import { estimateDossierCost } from "../processor/estimateDossierCost.js";
import { generateDossier } from "../processor/generateDossier.js";
import { getDossier } from "../processor/getDossier.js";

// Portal: pure HTTP-to-Reactor translation, no business logic.
//
// Note: every handler below returns `reply...send(...)` rather than calling
// `reply.send(...)` without returning it. In an async Fastify handler this
// matters a lot for streamed responses (see GET /books/:id/file) - if the
// handler's returned promise resolves before the manually-triggered send has
// finished, Fastify can tear down the response while the stream is still
// being piped, silently truncating the body to zero bytes.
export async function registerBookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/books", async (request, reply) => {
    const result = await listBooks(request.headers.authorization);
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>("/books/:id", async (request, reply) => {
    const result = await getBook(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });


  app.patch<{ Params: { id: string } }>("/books/:id", async (request, reply) => {
    const body = (request.body ?? {}) as { title?: unknown; author?: unknown; tags?: unknown };
    const result = await updateBook(request.headers.authorization, request.params.id, {
      title: body.title,
      author: body.author,
      tags: body.tags
    });
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { id: string } }>("/books/:id", async (request, reply) => {
    const result = await deleteBook(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.post("/books/upload", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "missing_file" });
    }
    const fileBuffer = await file.toBuffer();
    const result = await uploadEpub(request.headers.authorization, {
      fileBuffer,
      filename: file.filename
    });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>("/books/:id/file", async (request, reply) => {
    const result = await getBookFile(request.headers.authorization, request.params.id);
    if (result.kind === "json") {
      return reply.code(result.status).send(result.body);
    }
    return reply.code(result.status).type(result.contentType).send(result.stream);
  });

  app.put<{ Params: { id: string } }>("/books/:id/dossier", async (request, reply) => {
    const body = (request.body ?? {}) as { text?: unknown };
    const result = await uploadDossier(request.headers.authorization, request.params.id, { text: body.text });
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>("/books/:id/dossier", async (request, reply) => {
    const result = await getDossier(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>("/books/:id/dossier/estimate", async (request, reply) => {
    const result = await estimateDossierCost(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>("/books/:id/dossier/generate", async (request, reply) => {
    const result = await generateDossier(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.delete<{ Params: { id: string } }>("/books/:id/dossier", async (request, reply) => {
    const result = await deleteDossier(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>("/books/:id/archive", async (request, reply) => {
    const result = await archiveBook(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>("/books/:id/unarchive", async (request, reply) => {
    const result = await unarchiveBook(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.get<{ Params: { id: string } }>("/books/:id/annotations/export", async (request, reply) => {
    const result = await exportAnnotations(request.headers.authorization, request.params.id);
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { id: string } }>("/books/:id/annotations/import", async (request, reply) => {
    const result = await importAnnotations(request.headers.authorization, request.params.id, request.body);
    return reply.code(result.status).send(result.body);
  });
}
