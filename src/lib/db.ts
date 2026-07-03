import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

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

export async function connectDB(): Promise<typeof mongoose> {
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI environment variable is not set. " +
        "Add it to .env.local before calling connectDB()."
    );
  }

  if (!global._mongoosePromise) {
    global._mongoosePromise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  try {
    return await global._mongoosePromise;
  } catch (err) {
    global._mongoosePromise = undefined;
    throw err;
  }
}
