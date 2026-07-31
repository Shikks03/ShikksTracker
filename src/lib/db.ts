import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

// Mongoose 9 defaults strictQuery to false, which lets a filter path that
// doesn't exist in the schema pass straight through to Mongo unfiltered
// instead of being stripped/rejected. Pin it to true at module scope (a
// global mongoose setting, not per-connection) so an unexpected field in a
// query object can't silently widen a filter.
mongoose.set("strictQuery", true);

/**
 * Global cache so that hot reloads (Next.js dev) and serverless lambda
 * invocations reuse an existing connection instead of creating a new one.
 *
 * The cache is cleared on connection failure so the next call retries
 * instead of returning a permanently-rejected promise.
 */
declare global {
  // eslint-disable-next-line no-var
  var _mongoosePromise: Promise<typeof mongoose> | undefined;
}

/**
 * Validate the URI scheme before connecting. Never include the URI itself
 * in a thrown message — it carries the DB credentials.
 *
 *  - Always require mongodb:// or mongodb+srv://.
 *  - In production, require mongodb+srv:// specifically: SRV connection
 *    strings imply TLS, so this enforces transport encryption in prod
 *    without breaking a local plain mongodb:// dev server.
 */
function assertValidUriScheme(uri: string): void {
  const isMongoScheme = uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://");
  if (!isMongoScheme) {
    throw new Error(
      "MONGODB_URI must start with mongodb:// or mongodb+srv:// (URI omitted from this message; it contains credentials)."
    );
  }
  if (process.env.NODE_ENV === "production" && !uri.startsWith("mongodb+srv://")) {
    throw new Error(
      "MONGODB_URI must use the mongodb+srv:// scheme in production (SRV implies TLS). " +
        "URI omitted from this message; it contains credentials."
    );
  }
}

export async function connectDB(): Promise<typeof mongoose> {
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI environment variable is not set. " +
        "Add it to .env.local before calling connectDB()."
    );
  }

  // Scheme validation happens here (per-call), not at module scope — an
  // import-time throw would break the build even for code paths that never
  // call connectDB().
  assertValidUriScheme(MONGODB_URI);

  if (!global._mongoosePromise) {
    global._mongoosePromise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      autoIndex: process.env.NODE_ENV !== "production",
    });
  }

  try {
    return await global._mongoosePromise;
  } catch (err) {
    global._mongoosePromise = undefined;
    throw err;
  }
}
