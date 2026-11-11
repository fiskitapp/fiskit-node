import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Fiskit, FiskitError, verifyWebhook } from "../index.js";

/** A fetch that answers from a list and records every request. */
function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers ?? { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const INVOICE = { id: "inv_1", object: "invoice", status: "authorized", number: 42, cae: "76451234567890" };

test("creates an invoice with the key, the body and an idempotency key", async () => {
  const { fetch, calls } = fakeFetch([{ body: INVOICE }]);
  const client = new Fiskit("sk_test_x", { fetch, baseUrl: "https://api.test" });

  const invoice = await client.invoices.create({ voucher_type: "invoice_c", amounts: { total: 1500 } }, { idempotencyKey: "sale-1" });

  assert.equal(invoice.cae, "76451234567890");
  assert.equal(calls[0].url, "https://api.test/v1/invoices");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer sk_test_x");
  assert.equal(calls[0].headers["Idempotency-Key"], "sale-1");
  assert.deepEqual(JSON.parse(calls[0].body), { voucher_type: "invoice_c", amounts: { total: 1500 } });
});

test("retries an outage with the same generated idempotency key", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 503, body: { error: { type: "authority_error", code: "authority_unavailable", message: "down" } }, headers: { "retry-after": "0" } },
    new TypeError("socket hang up"),
    { body: INVOICE },
  ]);
  const client = new Fiskit("sk_test_x", { fetch, maxRetries: 2 });

  await client.invoices.create({ voucher_type: "invoice_c", amounts: { total: 1 } });

  assert.equal(calls.length, 3);
  const keys = new Set(calls.map((call) => call.headers["Idempotency-Key"]));
  assert.equal(keys.size, 1);
  assert.ok([...keys][0]);
});

test("API errors become a FiskitError with type, code and request id", async () => {
  const { fetch } = fakeFetch([
    { status: 400, body: { error: { type: "invalid_request_error", code: "parameter_invalid", message: "Bad total", param: "amounts.total", request_id: "req_1" } } },
  ]);
  const client = new Fiskit("sk_test_x", { fetch });

  await assert.rejects(client.invoices.retrieve("inv_1"), (error) => {
    assert.ok(error instanceof FiskitError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "parameter_invalid");
    assert.equal(error.param, "amounts.total");
    assert.equal(error.requestId, "req_1");
    return true;
  });
});

test("the pdf comes back as bytes and the taxpayer by CUIT", async () => {
  const { fetch, calls } = fakeFetch([
    { body: "%PDF-1.7", headers: { "content-type": "application/pdf" } },
    { body: { object: "taxpayer", cuit: 30712345671, vat_condition: "registered" } },
  ]);
  const client = new Fiskit("sk_test_x", { fetch });

  const pdf = await client.invoices.pdf("inv_1");
  const taxpayer = await client.taxpayers.retrieve(30712345671);

  assert.equal(pdf.toString(), "%PDF-1.7");
  assert.equal(calls[0].headers.Accept, "application/pdf");
  assert.equal(taxpayer.vat_condition, "registered");
  assert.match(calls[1].url, /\/v1\/taxpayers\/30712345671$/);
});

test("a POST without idempotency key is never retried after a network failure", async () => {
  const { fetch, calls } = fakeFetch([new TypeError("reset")]);
  const client = new Fiskit("sk_test_x", { fetch });

  await assert.rejects(client.invoices.email("inv_1", "a@b.com"), (error) => error.code === "network");
  assert.equal(calls.length, 1);
});

test("verifies webhooks with the Standard Webhooks example and rejects tampering", () => {
  // Example from the Standard Webhooks specification
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const headers = {
    "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
    "webhook-timestamp": "1614265330",
    "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  };
  const now = 1614265330 * 1000;

  assert.deepEqual(verifyWebhook('{"test": 2432232314}', headers, secret, { now }), { test: 2432232314 });
  assert.throws(() => verifyWebhook('{"test": 1}', headers, secret, { now }), /Invalid webhook signature/);
  assert.throws(() => verifyWebhook('{"test": 2432232314}', headers, secret, { now: now + 3600_000 }), /tolerance/);

  const key = Buffer.from(secret.slice(6), "base64");
  const signature = createHmac("sha256", key).update(`evt_1.1614265330.{}`).digest("base64");
  assert.deepEqual(verifyWebhook("{}", { ...headers, "webhook-id": "evt_1", "webhook-signature": `v1,${signature}` }, secret, { now }), {});
});
