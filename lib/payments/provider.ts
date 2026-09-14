// Workstream M — payment-provider abstraction (v1.2.0).
// A thin, provider-agnostic contract so IPPay (and future providers) can be
// swapped without touching call sites. SANDBOX ONLY in this release.

export type PaymentEnvironment = 'SANDBOX' | 'PRODUCTION';
export type PaymentMethodType = 'CARD' | 'ACH';

export interface ProviderConfig {
  environment: PaymentEnvironment;
  merchantId?: string | null;
  terminalId?: string | null;
  apiUsername?: string | null; // decrypted at the edge, never logged
  apiPassword?: string | null; // decrypted at the edge, never logged
}

export interface SaleRequest {
  amountCents: number;
  currency?: string;
  methodType: PaymentMethodType;
  // Card (sandbox test data only in this release)
  cardNumber?: string;
  cardExpMonth?: string;
  cardExpYear?: string;
  cardCvv?: string;
  // ACH
  routingNumber?: string;
  accountNumber?: string;
  // Correlation
  orderId?: string;
  requestId?: string;
}

export interface ProviderResult {
  ok: boolean;
  // maps onto internal PaymentStatus
  status: 'PENDING' | 'AUTHORIZED' | 'PAID' | 'DECLINED' | 'VOIDED' | 'REFUNDED' | 'FAILED';
  actionCode?: string | null;
  providerTransactionId?: string | null;
  providerReferenceId?: string | null; // approval code
  responseText?: string | null;
  cardLast4?: string | null;
  raw?: string; // sanitized (no PAN) raw response for debugging
}

export interface PaymentProvider {
  readonly name: string;
  testConnection(cfg: ProviderConfig): Promise<ProviderResult>;
  sale(cfg: ProviderConfig, req: SaleRequest): Promise<ProviderResult>;
}
