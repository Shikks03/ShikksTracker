import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Global cache so that hot reloads (Next.js dev) and serverless lambda
 * invocations reuse an existing connection instead of creating a new one.
 */
declare global {
  // eslint-disable-next-line no-var
  var _mongoosePromise: Promise<typeof mongoose> | undefined;
}

let cached = global._mongoosePromise;

export async function connectDB(): Promise<typeof mongoose> {
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI environment variable is not set. " +
        "Add it to .env.local before calling connectDB()."
    );
  }

  if (cached) {
    return cached;
  }

  cached = global._mongoosePromise = mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
  });

  return cached;
}
