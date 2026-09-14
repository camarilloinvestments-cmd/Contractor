// GET /api/v1/openapi.json — OpenAPI 3.0 description of the v1 API.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'OS1 Fiber Track Pro API',
    version: '1.0.0',
    description:
      'Versioned REST API for OS1 Fiber Track Pro. Authenticate with an API key: `Authorization: Bearer <key>`. Financial writes require an `Idempotency-Key` header.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API key (os1_sk_...)' },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/jobs': { get: { summary: 'List jobs', security: [{ ApiKeyAuth: ['jobs:read'] }], responses: { '200': { description: 'OK' } } } },
    '/invoices': { get: { summary: 'List invoices', security: [{ ApiKeyAuth: ['invoices:read'] }], responses: { '200': { description: 'OK' } } } },
    '/payments': {
      get: { summary: 'List payments', security: [{ ApiKeyAuth: ['payments:read'] }], responses: { '200': { description: 'OK' } } },
      post: {
        summary: 'Create a payment (sandbox)',
        description: 'Idempotent financial write. Provide an Idempotency-Key header.',
        security: [{ ApiKeyAuth: ['payments:write'] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { invoiceId: { type: 'string' }, amountCents: { type: 'integer' }, methodType: { type: 'string', enum: ['CARD', 'ACH'] } }, required: ['invoiceId'] } } },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'Bad request' }, '429': { description: 'Rate limited' } },
      },
    },
  },
  'x-resources': [
    'Users', 'Workers', 'Crews', 'Subcontractors', 'Prime Contractors', 'Contracts', 'Price Books', 'Rates',
    'Jobs', 'Tasks', 'Evidence', 'GPS', 'Geofences', 'Invoices', 'Payments', 'Payouts', 'Salespeople', 'Commissions', 'Devices',
  ],
};

export async function GET() {
  return NextResponse.json(spec);
}
