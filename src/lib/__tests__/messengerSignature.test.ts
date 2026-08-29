import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMetaSignature, verifyMetaVerifyToken } from "@/lib/messenger/signature";

const SECRET = "test_app_secret_value";
const BODY = '{"object":"page","entry":[]}';

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyMetaSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toEqual({ ok: true });
  });

  it("rejects a signature over different bytes", () => {
    const res = verifyMetaSignature('{"object":"page","entry":[1]}', sign(BODY), SECRET);
    expect(res.ok).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const res = verifyMetaSignature(BODY, sign(BODY, "other_secret"), SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.httpStatus).toBe(401);
  });

  it("rejects a missing header with 401", () => {
    const res = verifyMetaSignature(BODY, null, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.httpStatus).toBe(401);
  });

  it("rejects a header without the sha256= prefix", () => {
    const raw = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verifyMetaSignature(BODY, raw, SECRET).ok).toBe(false);
  });

  it("rejects a non-hex header without throwing", () => {
    expect(verifyMetaSignature(BODY, "sha256=zzzz", SECRET).ok).toBe(false);
  });

  it("fails CLOSED with 503 when the secret is unset", () => {
    const res = verifyMetaSignature(BODY, sign(BODY), undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.httpStatus).toBe(503);
  });

  it("is byte-exact: re-serialised JSON with the same meaning fails", () => {
    // The whole point of verifying the RAW body. JSON.parse+stringify changes
    // whitespace and key order, and the signature must not survive that.
    const reserialised = JSON.stringify(JSON.parse(BODY));
    const spaced = '{ "object": "page", "entry": [] }';
    expect(verifyMetaSignature(spaced, sign(reserialised), SECRET).ok).toBe(false);
  });
});

describe("verifyMetaVerifyToken", () => {
  it("returns the challenge on a correct subscribe handshake", () => {
    const res = verifyMetaVerifyToken("subscribe", "tok", "12345", "tok");
    expect(res).toEqual({ ok: true, challenge: "12345" });
  });

  it("rejects a wrong token", () => {
    expect(verifyMetaVerifyToken("subscribe", "wrong", "1", "tok").ok).toBe(false);
  });

  it("rejects a mode other than subscribe", () => {
    expect(verifyMetaVerifyToken("unsubscribe", "tok", "1", "tok").ok).toBe(false);
  });

  it("fails closed when the token is unset", () => {
    const res = verifyMetaVerifyToken("subscribe", "", "1", undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.httpStatus).toBe(503);
  });
});
