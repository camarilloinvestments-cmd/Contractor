/*
 * PRODUCTION / REFERENCE SEED (default).
 *
 * This seed contains NO user accounts and NO demo/operational records. It only
 * establishes non-sensitive reference & configuration data that a fresh
 * deployment needs to function:
 *   - Task types
 *   - Prime contractors (incl. Comcast) + rate cards
 *   - Default company profile
 *   - Email templates
 *   - Fleet provider settings (mock sandbox default)
 *   - Comcast closeout documentation workflow (config-driven)
 *
 * It creates NO logins. Create the first administrator explicitly and securely
 * with:  tsx --require dotenv/config scripts/bootstrap-admin.ts
 *
 * Demo/test accounts and sample jobs live in scripts/seed-demo.ts and are
 * OFF by default (guarded by ALLOW_DEMO_SEED=true, never hardcoded passwords).
 *
 * Idempotent: uses upsert only, never delete/deleteMany.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { COMCAST_CLOSEOUT_CONFIG } from '../lib/closeout/workflow-config';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding reference/configuration data (no user accounts)...');

  // Task Types
  const taskTypes = [
    { name: 'Splice - Single Mode', description: 'Single mode fiber optic splice', unitOfMeasure: 'each' },
    { name: 'Trench - Boring', description: 'Directional boring for conduit placement', unitOfMeasure: 'ft' },
    { name: 'Conduit - Install', description: 'Install conduit (innerduct or rigid)', unitOfMeasure: 'ft' },
    { name: 'Fiber Pull', description: 'Pull fiber cable through conduit', unitOfMeasure: 'ft' },
    { name: 'Lashing', description: 'Aerial lashing of fiber cable', unitOfMeasure: 'ft' },
  ];
  const createdTaskTypes: any[] = [];
  for (const tt of taskTypes) {
    const created = await prisma.taskType.upsert({ where: { name: tt.name }, update: {}, create: tt });
    createdTaskTypes.push(created);
  }

  // Prime Contractors
  const pc1 = await prisma.primeContractor.upsert({
    where: { id: 'pc-001' },
    update: {},
    create: {
      id: 'pc-001', companyName: 'Metro Fiber Networks', contactName: 'David Chen',
      email: 'dchen@metrofiber.com', phone: '(555) 111-2233', address: '1200 Industrial Pkwy',
      city: 'Dallas', state: 'TX', zip: '75201',
    },
  });
  const pc2 = await prisma.primeContractor.upsert({
    where: { id: 'pc-002' },
    update: {},
    create: {
      id: 'pc-002', companyName: 'Broadband Solutions Inc', contactName: 'Lisa Martinez',
      email: 'lmartinez@broadbandsol.com', phone: '(555) 444-5566', address: '3400 Tech Center Dr',
      city: 'Austin', state: 'TX', zip: '78701',
    },
  });

  // Prime Contractor Rate Cards
  for (const tt of createdTaskTypes) {
    const rates: Record<string, number[]> = {
      'Splice - Single Mode': [8500, 9000],
      'Trench - Boring': [1200, 1400],
      'Conduit - Install': [800, 850],
      'Fiber Pull': [500, 550],
      'Lashing': [600, 650],
    };
    const r = rates[tt.name] ?? [0, 0];
    await prisma.primeContractorRate.upsert({
      where: { primeContractorId_taskTypeId: { primeContractorId: pc1.id, taskTypeId: tt.id } },
      update: {}, create: { primeContractorId: pc1.id, taskTypeId: tt.id, ratePerUnit: r[0] },
    });
    await prisma.primeContractorRate.upsert({
      where: { primeContractorId_taskTypeId: { primeContractorId: pc2.id, taskTypeId: tt.id } },
      update: {}, create: { primeContractorId: pc2.id, taskTypeId: tt.id, ratePerUnit: r[1] },
    });
  }

  // Default company profile
  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default', companyName: 'OS1 Fiber Track Pro', tagline: 'Fiber Construction Services',
      primaryColor: '#1e40af', accentColor: '#0891b2', invoicePrefix: 'INV',
      invoiceFooter: 'Thank you for your business',
    },
  });

  // Email templates
  const emailTemplates = [
    {
      key: 'invoice_new', name: 'New Invoice',
      subject: 'Invoice {{invoice_number}} from {{company_name}}',
      bodyHtml: `<p>Dear {{prime_contractor_name}},</p>\n<p>Please find attached invoice <strong>{{invoice_number}}</strong> dated {{invoice_date}} for the amount of <strong>{{invoice_total}}</strong>.</p>\n<p>Outstanding balance: {{invoice_balance}}</p>\n<p>If you have any questions about this invoice, contact us at {{support_email}} or {{support_phone}}.</p>\n<p>Thank you for your business,<br/>{{company_name}}<br/>{{company_website}}</p>`,
      bodyText: `Dear {{prime_contractor_name}},\n\nPlease find attached invoice {{invoice_number}} dated {{invoice_date}} for the amount of {{invoice_total}}.\n\nOutstanding balance: {{invoice_balance}}\n\nIf you have any questions, contact us at {{support_email}} or {{support_phone}}.\n\nThank you for your business,\n{{company_name}}\n{{company_website}}`,
    },
    {
      key: 'invoice_reminder', name: 'Invoice Reminder',
      subject: 'Reminder: Invoice {{invoice_number}} is due {{invoice_due_date}}',
      bodyHtml: `<p>Dear {{prime_contractor_name}},</p>\n<p>This is a friendly reminder that invoice <strong>{{invoice_number}}</strong> for {{invoice_total}} is due on {{invoice_due_date}}.</p>\n<p>Outstanding balance: <strong>{{invoice_balance}}</strong></p>\n<p>Questions? Reach us at {{support_email}} or {{support_phone}}.</p>\n<p>{{company_name}}</p>`,
      bodyText: `Dear {{prime_contractor_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{invoice_total}} is due on {{invoice_due_date}}.\n\nOutstanding balance: {{invoice_balance}}\n\nQuestions? Reach us at {{support_email}} or {{support_phone}}.\n\n{{company_name}}`,
    },
    {
      key: 'test_email', name: 'Test Email',
      subject: 'Test email from {{company_name}}',
      bodyHtml: `<p>This is a test email from {{company_name}}.</p>\n<p>If you received this message, your outbound email configuration is working correctly.</p>`,
      bodyText: `This is a test email from {{company_name}}.\n\nIf you received this message, your outbound email configuration is working correctly.`,
    },
  ];
  for (const t of emailTemplates) {
    await prisma.emailTemplate.upsert({ where: { key: t.key }, update: {}, create: t });
  }

  // Fleet provider settings default to the MOCK sandbox (no real credentials).
  await prisma.fleetProviderSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default', provider: 'GEOTAB', enabled: false, syncEnabled: false,
      database: 'MOCK', username: '', serverUrl: 'my-mock.geotab.com',
      lastConnectionStatus: 'UNCONFIGURED',
    },
  });

  // Comcast prime contractor + config-driven closeout documentation workflow.
  const comcast = await prisma.primeContractor.upsert({
    where: { id: 'pc-comcast' },
    update: {},
    create: {
      id: 'pc-comcast', companyName: 'Comcast', contactName: 'Construction Documentation',
      email: 'construction@comcast.example', phone: '(800) 555-0100', address: '1701 JFK Blvd',
      city: 'Philadelphia', state: 'PA', zip: '19103',
    },
  });
  const comcastWorkflow = await prisma.documentationWorkflow.upsert({
    where: { id: 'dw-comcast' },
    update: { status: 'ACTIVE' },
    create: {
      id: 'dw-comcast', primeContractorId: comcast.id, name: 'Comcast Fiber Construction Closeout',
      workType: 'Fiber Construction', projectType: 'Aerial/Underground', status: 'ACTIVE',
    },
  });
  await prisma.documentationWorkflowVersion.upsert({
    where: { id: 'dwv-comcast-v1' },
    update: { status: 'ACTIVE', config: COMCAST_CLOSEOUT_CONFIG as unknown as Prisma.InputJsonValue },
    create: {
      id: 'dwv-comcast-v1', workflowId: comcastWorkflow.id, version: 1, status: 'ACTIVE',
      effectiveDate: new Date(), requireCloseoutBeforeInvoice: true,
      config: COMCAST_CLOSEOUT_CONFIG as unknown as Prisma.InputJsonValue,
    },
  });

  console.log('Reference seed complete. No user accounts were created.');
  console.log('Create the first admin with: tsx --require dotenv/config scripts/bootstrap-admin.ts');
}

main().catch(console.error).finally(() => prisma.$disconnect());
