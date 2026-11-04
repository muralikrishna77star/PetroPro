import type { FastifyInstance } from "fastify";
import { importLegacyFile, LegacyImportBlocked, previewLegacyFile } from "../services/legacyImport.js";

// Generous for one month or year of a petrol station's rows, and small enough for the API's machine.
const MAX_FILE_BYTES = 32 * 1024 * 1024;

interface FileQuery {
  filename?: string;
  backup?: string;
}

export default async function legacyImportRoutes(fastify: FastifyInstance) {
  // Scoped to this plugin. The file's raw bytes are the request body, and its name is in the URL.
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  const options = { preHandler: fastify.requireRole("super_admin"), bodyLimit: MAX_FILE_BYTES };

  fastify.post<{ Querystring: FileQuery; Body: Buffer }>("/legacy-import/preview", options, async (request, reply) => {
    const { filename } = request.query;
    if (!filename || !Buffer.isBuffer(request.body)) {
      return reply.code(400).send({ error: "A file and its name are required" });
    }
    return previewLegacyFile(filename, request.body);
  });

  fastify.post<{ Querystring: FileQuery; Body: Buffer }>("/legacy-import/commit", options, async (request, reply) => {
    const { filename, backup } = request.query;
    if (!filename || !Buffer.isBuffer(request.body)) {
      return reply.code(400).send({ error: "A file and its name are required" });
    }
    try {
      return importLegacyFile(filename, request.body, request.user.sub, backup === "1");
    } catch (err) {
      if (err instanceof LegacyImportBlocked) return reply.code(422).send({ error: err.message });
      throw err;
    }
  });
}
