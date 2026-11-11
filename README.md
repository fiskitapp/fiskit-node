# FisKit para Node.js

[English below](#english)

Cliente oficial de la API de [FisKit](https://fiskit.com.ar): facturas electrónicas de ARCA (ex AFIP) con un solo pedido. Sin dependencias, para Node 18 o superior.

```bash
npm install @fiskit/node
```

## Tu primera factura

```js
import { Fiskit } from "@fiskit/node";

const fiskit = new Fiskit(process.env.FISKIT_API_KEY);

// Con el id de tu venta como clave, un reintento nunca duplica la factura
const invoice = await fiskit.invoices.create(
  { voucher_type: "invoice_c", amounts: { total: 1500 } },
  { idempotencyKey: "venta-8812" },
);

console.log(invoice.number, invoice.cae);
```

Las claves `sk_test_...` emiten en la homologación de ARCA, sin validez fiscal. Las `sk_live_...` emiten facturas reales. Las dos se crean en el panel.

## Qué podés hacer

```js
await fiskit.invoices.retrieve(id);             // estado actual
const pdf = await fiskit.invoices.pdf(id);      // Buffer con el PDF y el QR de ARCA
await fiskit.invoices.email(id, "cliente@example.com");
await fiskit.taxpayers.retrieve(30712345671);   // nombre, domicilio y condición frente al IVA
```

Si ARCA no responde o se corta la conexión, el cliente reintenta solo con la misma `Idempotency-Key`. Si no pasás una, se genera automáticamente. Los errores llegan como `FiskitError`, con `status`, `type`, `code`, `message`, `param` y `requestId`.

## Webhooks

```js
import { verifyWebhook } from "@fiskit/node";

// Express: usá el cuerpo crudo, antes de parsearlo
app.post("/webhooks/fiskit", express.text({ type: "*/*" }), (req, res) => {
  const event = verifyWebhook(req.body, req.headers, process.env.FISKIT_WEBHOOK_SECRET);
  if (event.type === "invoice.authorized") {
    // event.data.object es la factura
  }
  res.sendStatus(200);
});
```

Documentación completa: https://fiskit.com.ar/developers

---

## English

Official client of the [FisKit](https://fiskit.com.ar) API: Argentine electronic invoices with ARCA (formerly AFIP) in a single request. No dependencies, Node 18 or later.

```js
import { Fiskit, verifyWebhook } from "@fiskit/node";

const fiskit = new Fiskit(process.env.FISKIT_API_KEY);

// Your sale id as the key: a retry never issues a second invoice
const invoice = await fiskit.invoices.create(
  { voucher_type: "invoice_c", amounts: { total: 1500 } },
  { idempotencyKey: "sale-8812" },
);

await fiskit.invoices.pdf(invoice.id);          // PDF with ARCA's QR code, as a Buffer
await fiskit.invoices.email(invoice.id, "customer@example.com");
await fiskit.taxpayers.retrieve(30712345671);   // name, address and VAT condition of a CUIT
```

`sk_test_...` keys issue against ARCA's homologation environment (no fiscal value); `sk_live_...` keys issue real invoices. Outages and dropped connections are retried with the same idempotency key, generated when you do not pass one. Errors are `FiskitError` instances with `status`, `type`, `code`, `message`, `param` and `requestId`. `verifyWebhook(rawBody, headers, secret)` checks Standard Webhooks signatures.

Full documentation: https://fiskit.com.ar/developers
