// Workstream M — IPPay provider (v1.2.0), SANDBOX ONLY.
//
// Endpoints (official IPPay XML gateway):
//   Sandbox:    https://testgtwy.ippay.com/ippay
//   Production: https://gtwy.ippay.com/ippay   (BLOCKED in this release)
//
// Requests are XML posted to the gateway. Response is XML wrapped in
// <IPPayResponse>; ActionCode "000" indicates approval. We never log PANs or
// credentials, and production charging is hard-disabled here.
import type { PaymentProvider, ProviderConfig, ProviderResult, SaleRequest } from './provider';

const SANDBOX_URL = 'https://testgtwy.ippay.com/ippay';
const PRODUCTION_URL = 'https://gtwy.ippay.com/ippay';

function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function endpointFor(cfg: ProviderConfig): string {
  // Hard guard: production charging is not authorized in this release.
  if (cfg.environment === 'PRODUCTION') {
    throw new Error('IPPay PRODUCTION mode is disabled in this release (sandbox only).');
  }
  return SANDBOX_URL;
}

function mapAction(actionCode: string | null): ProviderResult['status'] {
  if (actionCode === '000') return 'PAID';
  return 'DECLINED';
}

async function post(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body,
    // guard against a hung gateway
    signal: AbortSignal.timeout(20000),
  });
  return await res.text();
}

export class IPPayProvider implements PaymentProvider {
  readonly name = 'IPPAY';

  async testConnection(cfg: ProviderConfig): Promise<ProviderResult> {
    // A zero-dollar/AccountInquiry style probe. If the terminal is missing we
    // fail fast without hitting the network.
    if (!cfg.terminalId) {
      return { ok: false, status: 'FAILED', responseText: 'Terminal ID is not configured.' };
    }
    try {
      const url = endpointFor(cfg);
      const xml =
        `<ippay><TransactionType>ACCOUNTINQUIRY</TransactionType>` +
        `<TerminalID>${xmlEscape(cfg.terminalId)}</TerminalID></ippay>`;
      const resp = await post(url, xml);
      const actionCode = tag(resp, 'ActionCode');
      const responseText = tag(resp, 'ResponseText') || tag(resp, 'ErrMsg');
      // Any well-formed XML response from the gateway proves connectivity +
      // that the terminal is recognized (even a decline is a live response).
      const reachable = /<IPPayResponse|<ippayResponse|<ActionCode/i.test(resp);
      return {
        ok: reachable,
        status: reachable ? 'PENDING' : 'FAILED',
        actionCode,
        responseText: responseText || (reachable ? 'Gateway reachable.' : 'No valid response from gateway.'),
      };
    } catch (e: any) {
      return { ok: false, status: 'FAILED', responseText: e?.message || 'Connection failed.' };
    }
  }

  async sale(cfg: ProviderConfig, req: SaleRequest): Promise<ProviderResult> {
    const url = endpointFor(cfg);
    if (!cfg.terminalId) {
      return { ok: false, status: 'FAILED', responseText: 'Terminal ID is not configured.' };
    }
    // IPPay TotalAmount is dollars.cents string.
    const amount = (req.amountCents / 100).toFixed(2);
    let inner = '';
    let last4: string | null = null;
    if (req.methodType === 'ACH') {
      inner =
        `<TransactionType>CHECK</TransactionType>` +
        `<ABA>${xmlEscape(req.routingNumber || '')}</ABA>` +
        `<AccountNumber>${xmlEscape(req.accountNumber || '')}</AccountNumber>`;
      last4 = (req.accountNumber || '').slice(-4) || null;
    } else {
      inner =
        `<TransactionType>SALE</TransactionType>` +
        `<CardNum>${xmlEscape(req.cardNumber || '')}</CardNum>` +
        `<CardExpMonth>${xmlEscape(req.cardExpMonth || '')}</CardExpMonth>` +
        `<CardExpYear>${xmlEscape(req.cardExpYear || '')}</CardExpYear>` +
        (req.cardCvv ? `<CVV2>${xmlEscape(req.cardCvv)}</CVV2>` : '');
      last4 = (req.cardNumber || '').slice(-4) || null;
    }
    const xml =
      `<ippay>` +
      inner +
      `<TerminalID>${xmlEscape(cfg.terminalId)}</TerminalID>` +
      `<TotalAmount>${amount}</TotalAmount>` +
      `<Currency>${xmlEscape(req.currency || 'USD')}</Currency>` +
      (req.orderId ? `<OrderNumber>${xmlEscape(req.orderId)}</OrderNumber>` : '') +
      (req.requestId ? `<UDField1>${xmlEscape(req.requestId)}</UDField1>` : '') +
      `</ippay>`;
    try {
      const resp = await post(url, xml);
      const actionCode = tag(resp, 'ActionCode');
      const status = mapAction(actionCode);
      // Never retain the raw request; only sanitized response fields are kept.
      return {
        ok: status === 'PAID',
        status,
        actionCode,
        providerTransactionId: tag(resp, 'TransactionID'),
        providerReferenceId: tag(resp, 'Approval'),
        responseText: tag(resp, 'ResponseText') || tag(resp, 'ErrMsg'),
        cardLast4: last4,
      };
    } catch (e: any) {
      return { ok: false, status: 'FAILED', responseText: e?.message || 'Sale request failed.', cardLast4: last4 };
    }
  }
}
