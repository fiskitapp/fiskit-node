// Official Node.js client for the FisKit API: electronic invoices with ARCA.
// No dependencies: it uses the fetch and crypto built into Node 18+.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.fiskit.com.ar";
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

/** An error answered by the API, or a network failure (status 0). */
export class FiskitError extends Error {
  constructor({ status, type, code, message, param, requestId, body }) {
    super(message);
    this.name = "FiskitError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
    this.requestId = requestId;
    this.body = body;
  }
}

export class Fiskit {
  /**
   * @param {string} apiKey sk_test_... or sk_live_...; by default FISKIT_API_KEY
   * @param {{ baseUrl?: string, maxRetries?: number, timeoutMs?: number, fetch?: typeof fetch }} [options]
   */
  constructor(apiKey = process.env.FISKIT_API_KEY, options = {}) {
    if (!apiKey) throw new Error("Missing API key: pass it or set FISKIT_API_KEY");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetch = options.fetch ?? globalThis.fetch;

    this.invoices = {
      /**
       * Issues an invoice. Without idempotencyKey one is generated, so the automatic retries never issue
       * a second invoice. Pass your own (for example your sale id) to make your retries safe too.
       */
      create: (body, { idempotencyKey } = {}) =>
        this.request("POST", "/v1/invoices", { body, idempotencyKey: idempotencyKey ?? randomUUID() }),
      retrieve: (id) => this.request("GET", `/v1/invoices/${encodeURIComponent(id)}`),
      /** The voucher PDF as a Buffer. */
      pdf: (id) => this.request("GET", `/v1/invoices/${encodeURIComponent(id)}/pdf`, { binary: true }),
      /** Emails the PDF to the customer; without email, to receiver.email of the invoice. */
      email: (id, email) =>
        this.request("POST", `/v1/invoices/${encodeURIComponent(id)}/email`, { body: email ? { email } : {} }),
    };

    this.taxpayers = {
      /** Name, address and VAT condition of a CUIT, from the ARCA registry. */
      retrieve: (cuit) => this.request("GET", `/v1/taxpayers/${encodeURIComponent(String(cuit))}`),
    };
  }

  async request(method, path, { body, idempotencyKey, binary = false } = {}) {
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: binary ? "application/pdf" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(this.baseUrl + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        // Without an idempotency key a POST is not repeated: it might have been processed
        if ((method === "GET" || idempotencyKey) && attempt < this.maxRetries) {
          await wait(attempt);
          continue;
        }
        throw new FiskitError({ status: 0, type: "connection_error", code: "network", message: String(cause?.message ?? cause) });
      }

      if (response.ok) {
        if (binary) return Buffer.from(await response.arrayBuffer());
        return response.status === 204 ? null : response.json();
      }
      if (RETRYABLE.has(response.status) && (method === "GET" || idempotencyKey) && attempt < this.maxRetries) {
        await wait(attempt, response.headers.get("retry-after"));
        continue;
      }
      const payload = await response.json().catch(() => null);
      const error = payload?.error ?? {};
      throw new FiskitError({
        status: response.status,
        type: error.type ?? "api_error",
        code: error.code ?? `http_${response.status}`,
        message: error.message ?? `HTTP ${response.status}`,
        param: error.param,
        requestId: error.request_id ?? response.headers.get("request-id"),
        body: payload,
      });
    }
  }
}

function wait(attempt, retryAfter) {
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : 500 * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks a webhook (Standard Webhooks) and returns the parsed event. Throws if the signature is wrong or
 * older than toleranceSeconds. Pass the raw body as received, before parsing it.
 *
 * @param {string} rawBody
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} secret whsec_... from the dashboard
 */
export function verifyWebhook(rawBody, headers, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const header = (name) => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const id = header("webhook-id");
  const timestamp = header("webhook-timestamp");
  const signatures = header("webhook-signature");
  if (!id || !timestamp || !signatures) throw new Error("Missing webhook headers");
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) throw new Error("Webhook timestamp out of tolerance");

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const valid = signatures
    .split(" ")
    .map((part) => part.replace(/^v1,/, ""))
    .some((candidate) => candidate.length === expected.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)));
  if (!valid) throw new Error("Invalid webhook signature");
  return JSON.parse(rawBody);
}

export default Fiskit;
