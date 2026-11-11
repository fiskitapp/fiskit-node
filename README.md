# FisKit para Node.js

Cliente oficial de la API de [FisKit](https://fiskit.com.ar): facturas electrónicas de ARCA (ex AFIP) con un solo pedido. Sin dependencias, para Node 18 o superior.

```bash
npm install @fiskit/node
```

## Tu primera factura

```js
import { Fiskit } from "@fiskit/node";

const fiskit = new Fiskit(process.env.FISKIT_API_KEY);

const invoice = await fiskit.invoices.create(
  { voucher_type: "invoice_c", amounts: { total: 1500 } },
  { idempotencyKey: "venta-8812" }, // el id de tu venta: un reintento nunca duplica la factura
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

Si ARCA no responde o se corta la conexión, el cliente reintenta solo con la misma `Idempotency-Key`. Si no pasás una, se genera automáticamente.

Los errores llegan como `FiskitError`, con `status`, `type`, `code`, `message`, `param` y `requestId`.

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
