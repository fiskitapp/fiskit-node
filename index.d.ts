export type VoucherType =
  | "invoice_a" | "debit_note_a" | "credit_note_a"
  | "invoice_b" | "debit_note_b" | "credit_note_b"
  | "invoice_c" | "debit_note_c" | "credit_note_c";

export type VatRate = "0" | "2.5" | "5" | "10.5" | "21" | "27";

export interface CreateInvoice {
  voucher_type: VoucherType;
  amounts: {
    total: number | string;
    vat_rate?: VatRate;
    net?: number | string;
    vat?: number | string;
    untaxed?: number | string;
    exempt?: number | string;
  };
  point_of_sale?: number;
  concept?: "products" | "services" | "products_and_services";
  date?: string;
  receiver?: {
    document_type?: "cuit" | "cuil" | "dni" | "final_consumer";
    document_number?: number;
    vat_condition_id?: number;
    name?: string;
    address?: string;
    email?: string;
  };
  vat_breakdown?: { rate: VatRate; taxable_base: number | string; amount: number | string }[];
  service_period?: { from: string; to: string; payment_due_date: string };
  currency?: { code: string; exchange_rate: number | string };
  associated_vouchers?: { voucher_type: VoucherType; point_of_sale: number; number: number; issuer_cuit?: number; date?: string }[];
  items?: { description: string; quantity?: number | string; unit_price: number | string }[];
  notes?: string;
}

export interface Invoice {
  id: string;
  object: "invoice";
  status: "pending" | "processing" | "authorized" | "rejected" | "reconciling" | "failed";
  voucher_type: VoucherType;
  point_of_sale: number;
  number: number | null;
  cae: string | null;
  cae_due_date: string | null;
  authority_observations: { code: number; message: string }[];
  authority_errors: { code: number; message: string }[];
}

export interface Taxpayer {
  object: "taxpayer";
  cuit: number;
  name: string | null;
  type: "person" | "company";
  active: boolean;
  vat_condition: "registered" | "monotributo" | "exempt" | "not_registered";
  receiver_vat_condition_id: number;
  voucher_letter_for_registered_issuer: "A" | "B";
  monotributo_category: string | null;
  address: { street: string | null; city: string | null; province: string | null; postal_code: string | null } | null;
}

export interface WebhookEvent {
  id: string;
  object: "event";
  type: "invoice.authorized" | "invoice.rejected" | "invoice.failed" | "webhook.test";
  created: string;
  livemode: boolean;
  data: { object: Invoice | Record<string, unknown> };
}

export class FiskitError extends Error {
  status: number;
  type: string;
  code: string;
  param?: string;
  requestId?: string;
  body: unknown;
}

export interface FiskitOptions {
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class Fiskit {
  constructor(apiKey?: string, options?: FiskitOptions);
  invoices: {
    create(body: CreateInvoice, options?: { idempotencyKey?: string }): Promise<Invoice>;
    retrieve(id: string): Promise<Invoice>;
    pdf(id: string): Promise<Buffer>;
    email(id: string, email?: string): Promise<{ email: string }>;
  };
  taxpayers: {
    retrieve(cuit: number | string): Promise<Taxpayer>;
  };
}

export function verifyWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): WebhookEvent;

export default Fiskit;
