import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Hidden test account
  const testHash = await bcrypt.hash('21#3rGkWLE', 12);
  await prisma.user.upsert({
    where: { email: 'abacus-d27c5c38@example.com' },
    update: {},
    create: { email: 'abacus-d27c5c38@example.com', name: 'System Admin', passwordHash: testHash, role: 'ADMIN' },
  });

  // Admin user (visible)
  const adminHash = await bcrypt.hash('Admin123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@fibertrack.com' },
    update: {},
    create: { email: 'admin@fibertrack.com', name: 'Mike Johnson', passwordHash: adminHash, role: 'ADMIN' },
  });

  // Project Manager
  const pmHash = await bcrypt.hash('Manager123!', 12);
  await prisma.user.upsert({
    where: { email: 'pm@fibertrack.com' },
    update: {},
    create: { email: 'pm@fibertrack.com', name: 'Sarah Williams', passwordHash: pmHash, role: 'PROJECT_MANAGER' },
  });

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
    const created = await prisma.taskType.upsert({
      where: { name: tt.name },
      update: {},
      create: tt,
    });
    createdTaskTypes.push(created);
  }

  // Workers
  const worker1 = await prisma.worker.upsert({
    where: { id: 'worker-sub-001' },
    update: {},
    create: {
      id: 'worker-sub-001',
      name: 'Carlos Ramirez',
      workerType: 'SUBCONTRACTOR',
      email: 'carlos@ramirezsplicing.com',
      phone: '(555) 234-5678',
      companyName: 'Ramirez Splicing LLC',
    },
  });

  const worker2 = await prisma.worker.upsert({
    where: { id: 'worker-inh-001' },
    update: {},
    create: {
      id: 'worker-inh-001',
      name: 'Jake Thompson',
      workerType: 'IN_HOUSE',
      email: 'jake@fibertrack.com',
      phone: '(555) 345-6789',
    },
  });

  // Worker user accounts
  const w1Hash = await bcrypt.hash('Worker123!', 12);
  await prisma.user.upsert({
    where: { email: 'carlos@ramirezsplicing.com' },
    update: {},
    create: {
      email: 'carlos@ramirezsplicing.com',
      name: 'Carlos Ramirez',
      passwordHash: w1Hash,
      role: 'FIELD_WORKER',
      workerId: worker1.id,
    },
  });

  const w2Hash = await bcrypt.hash('Worker123!', 12);
  await prisma.user.upsert({
    where: { email: 'jake@fibertrack.com' },
    update: {},
    create: {
      email: 'jake@fibertrack.com',
      name: 'Jake Thompson',
      passwordHash: w2Hash,
      role: 'FIELD_WORKER',
      workerId: worker2.id,
    },
  });

  // Worker rates
  for (const tt of createdTaskTypes) {
    const rates: Record<string, number[]> = {
      'Splice - Single Mode': [5500, 4500],
      'Trench - Boring': [800, 700],
      'Conduit - Install': [500, 400],
      'Fiber Pull': [300, 250],
      'Lashing': [400, 350],
    };
    const r = rates[tt.name] ?? [0, 0];
    await prisma.workerRate.upsert({
      where: { workerId_taskTypeId: { workerId: worker1.id, taskTypeId: tt.id } },
      update: {},
      create: { workerId: worker1.id, taskTypeId: tt.id, ratePerUnit: r[0] },
    });
    await prisma.workerRate.upsert({
      where: { workerId_taskTypeId: { workerId: worker2.id, taskTypeId: tt.id } },
      update: {},
      create: { workerId: worker2.id, taskTypeId: tt.id, ratePerUnit: r[1] },
    });
  }

  // Prime Contractors
  const pc1 = await prisma.primeContractor.upsert({
    where: { id: 'pc-001' },
    update: {},
    create: {
      id: 'pc-001',
      companyName: 'Metro Fiber Networks',
      contactName: 'David Chen',
      email: 'dchen@metrofiber.com',
      phone: '(555) 111-2233',
      address: '1200 Industrial Pkwy',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
    },
  });

  const pc2 = await prisma.primeContractor.upsert({
    where: { id: 'pc-002' },
    update: {},
    create: {
      id: 'pc-002',
      companyName: 'Broadband Solutions Inc',
      contactName: 'Lisa Martinez',
      email: 'lmartinez@broadbandsol.com',
      phone: '(555) 444-5566',
      address: '3400 Tech Center Dr',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
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
      update: {},
      create: { primeContractorId: pc1.id, taskTypeId: tt.id, ratePerUnit: r[0] },
    });
    await prisma.primeContractorRate.upsert({
      where: { primeContractorId_taskTypeId: { primeContractorId: pc2.id, taskTypeId: tt.id } },
      update: {},
      create: { primeContractorId: pc2.id, taskTypeId: tt.id, ratePerUnit: r[1] },
    });
  }

  // Jobs
  const job1 = await prisma.job.upsert({
    where: { jobNumber: 'JOB-0001' },
    update: {},
    create: {
      jobNumber: 'JOB-0001',
      jobName: 'Downtown Dallas FTTH Build',
      primeContractorId: pc1.id,
      address: '500 Main St',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      latitude: 32.7767,
      longitude: -96.7970,
      status: 'IN_PROGRESS',
      startDate: new Date('2026-08-01'),
      dueDate: new Date('2026-10-15'),
    },
  });

  const job2 = await prisma.job.upsert({
    where: { jobNumber: 'JOB-0002' },
    update: {},
    create: {
      jobNumber: 'JOB-0002',
      jobName: 'Austin Business Park Fiber Run',
      primeContractorId: pc2.id,
      address: '1800 Congress Ave',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      latitude: 30.2672,
      longitude: -97.7431,
      status: 'APPROVED',
      startDate: new Date('2026-07-15'),
      dueDate: new Date('2026-09-01'),
    },
  });

  // Tasks for Job 1 (in progress)
  const spliceType = createdTaskTypes.find((t: any) => t.name === 'Splice - Single Mode');
  const trenchType = createdTaskTypes.find((t: any) => t.name === 'Trench - Boring');
  const conduitType = createdTaskTypes.find((t: any) => t.name === 'Conduit - Install');
  const fiberPullType = createdTaskTypes.find((t: any) => t.name === 'Fiber Pull');
  const lashingType = createdTaskTypes.find((t: any) => t.name === 'Lashing');

  // Job 1 tasks
  await prisma.task.upsert({
    where: { id: 'task-001' },
    update: {},
    create: {
      id: 'task-001', jobId: job1.id, taskTypeId: spliceType.id,
      description: 'Splice fiber at MH-101', quantity: 24,
      billingRate: 8500, workerPayoutRate: 5500,
      workerId: worker1.id, status: 'IN_PROGRESS',
      billableAmount: 24 * 8500, costAmount: 24 * 5500, profitAmount: 24 * (8500 - 5500),
    },
  });

  await prisma.task.upsert({
    where: { id: 'task-002' },
    update: {},
    create: {
      id: 'task-002', jobId: job1.id, taskTypeId: trenchType.id,
      description: 'Bore from MH-101 to MH-102', quantity: 450,
      billingRate: 1200, workerPayoutRate: 800,
      workerId: worker2.id, status: 'SUBMITTED',
      billableAmount: 450 * 1200, costAmount: 450 * 800, profitAmount: 450 * (1200 - 800),
    },
  });

  await prisma.task.upsert({
    where: { id: 'task-003' },
    update: {},
    create: {
      id: 'task-003', jobId: job1.id, taskTypeId: conduitType.id,
      description: 'Install 2" conduit MH-101 to MH-102', quantity: 450,
      billingRate: 800, workerPayoutRate: 500,
      workerId: worker2.id, status: 'PENDING',
      billableAmount: 450 * 800, costAmount: 450 * 500, profitAmount: 450 * (800 - 500),
    },
  });

  // Job 2 tasks (approved)
  await prisma.task.upsert({
    where: { id: 'task-004' },
    update: {},
    create: {
      id: 'task-004', jobId: job2.id, taskTypeId: fiberPullType.id,
      description: 'Pull 288ct fiber from POP to Building A', quantity: 1200,
      billingRate: 550, workerPayoutRate: 300,
      workerId: worker1.id, status: 'APPROVED',
      billableAmount: 1200 * 550, costAmount: 1200 * 300, profitAmount: 1200 * (550 - 300),
    },
  });

  await prisma.task.upsert({
    where: { id: 'task-005' },
    update: {},
    create: {
      id: 'task-005', jobId: job2.id, taskTypeId: lashingType.id,
      description: 'Lash cable from Pole 1-15', quantity: 800,
      billingRate: 650, workerPayoutRate: 400,
      workerId: worker2.id, status: 'APPROVED',
      billableAmount: 800 * 650, costAmount: 800 * 400, profitAmount: 800 * (650 - 400),
    },
  });

  // Activity logs
  await prisma.activityLog.upsert({
    where: { id: 'log-001' },
    update: {},
    create: {
      id: 'log-001', jobId: job1.id, taskId: 'task-001', workerId: worker1.id,
      activityType: 'CHECK_IN', description: 'Checked in at job site',
      latitude: 32.7769, longitude: -96.7969, gpsAccuracy: 5,
      distanceFromJob: 45, proximityWarning: false,
    },
  });

  await prisma.activityLog.upsert({
    where: { id: 'log-002' },
    update: {},
    create: {
      id: 'log-002', jobId: job1.id, taskId: 'task-002', workerId: worker2.id,
      activityType: 'STATUS_UPDATE', description: 'Boring complete - 450ft',
      latitude: 32.7771, longitude: -96.7965, gpsAccuracy: 8,
      distanceFromJob: 120, proximityWarning: false,
    },
  });

  await prisma.activityLog.upsert({
    where: { id: 'log-003' },
    update: {},
    create: {
      id: 'log-003', jobId: job1.id, taskId: 'task-002', workerId: worker2.id,
      activityType: 'NOTE', description: 'Hit a rock formation at 200ft - had to adjust path slightly',
    },
  });

  await prisma.activityLog.upsert({
    where: { id: 'log-004' },
    update: {},
    create: {
      id: 'log-004', jobId: job2.id, taskId: 'task-004', workerId: worker1.id,
      activityType: 'STATUS_UPDATE', description: 'Fiber pull complete',
      latitude: 30.2675, longitude: -97.7428, gpsAccuracy: 3,
      distanceFromJob: 80, proximityWarning: false,
    },
  });

  // --- Phase 1 (v1.1.0): branding + email templates (idempotent) ---
  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      companyName: 'OS1 Fiber Track Pro',
      tagline: 'Fiber Construction Services',
      primaryColor: '#1e40af',
      accentColor: '#0891b2',
      invoicePrefix: 'INV',
      invoiceFooter: 'Thank you for your business',
    },
  });

  const emailTemplates = [
    {
      key: 'invoice_new',
      name: 'New Invoice',
      subject: 'Invoice {{invoice_number}} from {{company_name}}',
      bodyHtml: `<p>Dear {{prime_contractor_name}},</p>\n<p>Please find attached invoice <strong>{{invoice_number}}</strong> dated {{invoice_date}} for the amount of <strong>{{invoice_total}}</strong>.</p>\n<p>Outstanding balance: {{invoice_balance}}</p>\n<p>If you have any questions about this invoice, contact us at {{support_email}} or {{support_phone}}.</p>\n<p>Thank you for your business,<br/>{{company_name}}<br/>{{company_website}}</p>`,
      bodyText: `Dear {{prime_contractor_name}},\n\nPlease find attached invoice {{invoice_number}} dated {{invoice_date}} for the amount of {{invoice_total}}.\n\nOutstanding balance: {{invoice_balance}}\n\nIf you have any questions, contact us at {{support_email}} or {{support_phone}}.\n\nThank you for your business,\n{{company_name}}\n{{company_website}}`,
    },
    {
      key: 'invoice_reminder',
      name: 'Invoice Reminder',
      subject: 'Reminder: Invoice {{invoice_number}} is due {{invoice_due_date}}',
      bodyHtml: `<p>Dear {{prime_contractor_name}},</p>\n<p>This is a friendly reminder that invoice <strong>{{invoice_number}}</strong> for {{invoice_total}} is due on {{invoice_due_date}}.</p>\n<p>Outstanding balance: <strong>{{invoice_balance}}</strong></p>\n<p>Questions? Reach us at {{support_email}} or {{support_phone}}.</p>\n<p>{{company_name}}</p>`,
      bodyText: `Dear {{prime_contractor_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{invoice_total}} is due on {{invoice_due_date}}.\n\nOutstanding balance: {{invoice_balance}}\n\nQuestions? Reach us at {{support_email}} or {{support_phone}}.\n\n{{company_name}}`,
    },
    {
      key: 'test_email',
      name: 'Test Email',
      subject: 'Test email from {{company_name}}',
      bodyHtml: `<p>This is a test email from {{company_name}}.</p>\n<p>If you received this message, your outbound email configuration is working correctly.</p>`,
      bodyText: `This is a test email from {{company_name}}.\n\nIf you received this message, your outbound email configuration is working correctly.`,
    },
  ];
  for (const t of emailTemplates) {
    await prisma.emailTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: t,
    });
  }

  // --- Increment 8 (v1.2.0): Fleet telematics (Geotab) demo data (idempotent) ---
  // Provider settings default to the MOCK sandbox so the Live Map + sync work out of the box.
  await prisma.fleetProviderSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      provider: 'GEOTAB',
      enabled: true,
      syncEnabled: true,
      database: 'MOCK',
      username: 'demo@os1fibertrack.com',
      serverUrl: 'my-mock.geotab.com',
      lastConnectionStatus: 'OK',
      lastSuccessAt: new Date(),
    },
  });

  // Demo crew and membership (Carlos assigned to the field crew).
  const crew1 = await prisma.crew.upsert({
    where: { id: 'crew-001' },
    update: {},
    create: {
      id: 'crew-001',
      name: 'Fresno Splice Crew A',
      subcontractorCompany: 'Ramirez Splicing LLC',
      notes: 'Primary splicing crew for Central Valley builds.',
      active: true,
    },
  });
  await prisma.worker.update({ where: { id: worker1.id }, data: { crewId: crew1.id } });

  // Demo job at the mock job site (downtown Fresno) with an explicit geofence.
  const jobFresno = await prisma.job.upsert({
    where: { jobNumber: 'JOB-0003' },
    update: {},
    create: {
      jobNumber: 'JOB-0003',
      jobName: 'Fresno Central Valley FTTH',
      primeContractorId: pc1.id,
      address: '2600 Fresno St',
      city: 'Fresno',
      state: 'CA',
      zip: '93721',
      latitude: 36.7378,
      longitude: -119.7871,
      geofenceRadiusFeet: 500,
      status: 'ACTIVE',
      startDate: new Date('2026-08-15'),
      dueDate: new Date('2026-11-30'),
    },
  });

  // Fleet vehicles matching the mock Geotab devices. Truck 121 is assigned to the crew,
  // Carlos, and the Fresno job so the Live Map shows a fully-linked truck immediately.
  const truck121 = await prisma.fleetVehicle.upsert({
    where: { provider_geotabDeviceId: { provider: 'GEOTAB', geotabDeviceId: 'GT-DEV-TRUCK121' } },
    update: {},
    create: {
      provider: 'GEOTAB',
      geotabDeviceId: 'GT-DEV-TRUCK121',
      name: 'Truck 121',
      vehicleNumber: '121',
      vin: '1FTFW1EF1EKE00121',
      licensePlate: 'OS1-121',
      make: 'Ford',
      model: 'F-250',
      year: 2021,
      active: true,
      assignedCrewId: crew1.id,
      assignedWorkerId: worker1.id,
      subcontractorCompany: 'Ramirez Splicing LLC',
      currentJobId: jobFresno.id,
    },
  });
  const van207 = await prisma.fleetVehicle.upsert({
    where: { provider_geotabDeviceId: { provider: 'GEOTAB', geotabDeviceId: 'GT-DEV-VAN207' } },
    update: {},
    create: {
      provider: 'GEOTAB',
      geotabDeviceId: 'GT-DEV-VAN207',
      name: 'Splice Van 207',
      vehicleNumber: '207',
      vin: '1GCWGAFP7N1200207',
      licensePlate: 'OS1-207',
      make: 'Chevrolet',
      model: 'Express',
      year: 2022,
      active: true,
    },
  });

  // Current vehicle state (recent = not stale) sitting at the Fresno job site.
  await prisma.vehicleState.upsert({
    where: { vehicleId: truck121.id },
    update: {},
    create: {
      vehicleId: truck121.id,
      latitude: 36.7378,
      longitude: -119.7871,
      recordedAt: new Date(),
      speed: 0,
      bearing: 135,
      motion: 'STOPPED',
      communicating: true,
      currentDriverName: 'Jose Camarillo',
      currentJobId: jobFresno.id,
      lastUpdateAt: new Date(),
    },
  });
  await prisma.vehicleState.upsert({
    where: { vehicleId: van207.id },
    update: {},
    create: {
      vehicleId: van207.id,
      latitude: 36.7189,
      longitude: -119.7620,
      recordedAt: new Date(Date.now() - 2 * 60 * 1000),
      speed: 32,
      bearing: 315,
      motion: 'DRIVING',
      communicating: true,
      currentDriverName: 'Field Driver',
      lastUpdateAt: new Date(Date.now() - 2 * 60 * 1000),
    },
  });

  // Historical telemetry (persisted across restarts; deduped on [vehicleId, providerRef]).
  const truckBase = { lat: 36.7601, lng: -119.812 };
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    const lat = truckBase.lat + (36.7378 - truckBase.lat) * t;
    const lng = truckBase.lng + (-119.7871 - truckBase.lng) * t;
    await prisma.vehicleTelemetry.upsert({
      where: { vehicleId_providerRef: { vehicleId: truck121.id, providerRef: `GT-DEV-TRUCK121-step${step}` } },
      update: {},
      create: {
        vehicleId: truck121.id,
        source: 'GEOTAB',
        recordedAt: new Date(Date.now() - (8 - step) * 5 * 60 * 1000),
        latitude: lat,
        longitude: lng,
        speed: step >= 8 ? 0 : 45,
        bearing: 135,
        driverName: 'Jose Camarillo',
        jobId: jobFresno.id,
        crewId: crew1.id,
        providerRef: `GT-DEV-TRUCK121-step${step}`,
      },
    });
  }

  // Geofence events: distinct VEHICLE_ARRIVED and WORKER_ARRIVED at the Fresno site.
  await prisma.geoEvent.upsert({
    where: { id: 'geoevent-veh-001' },
    update: {},
    create: {
      id: 'geoevent-veh-001',
      eventType: 'VEHICLE_ARRIVED',
      actorType: 'VEHICLE',
      jobId: jobFresno.id,
      vehicleId: truck121.id,
      crewId: crew1.id,
      latitude: 36.7378,
      longitude: -119.7871,
      occurredAt: new Date(Date.now() - 20 * 60 * 1000),
      source: 'GEOTAB',
      providerRef: 'GT-DEV-TRUCK121-step8',
    },
  });
  await prisma.geoEvent.upsert({
    where: { id: 'geoevent-wrk-001' },
    update: {},
    create: {
      id: 'geoevent-wrk-001',
      eventType: 'WORKER_ARRIVED',
      actorType: 'WORKER',
      jobId: jobFresno.id,
      workerId: worker1.id,
      crewId: crew1.id,
      latitude: 36.7379,
      longitude: -119.7869,
      occurredAt: new Date(Date.now() - 15 * 60 * 1000),
      source: 'MOBILE_APP',
    },
  });

  // Separate mobile-worker GPS stream (kept distinct from truck GPS).
  await prisma.workerLocation.upsert({
    where: { id: 'workerloc-001' },
    update: {},
    create: {
      id: 'workerloc-001',
      workerId: worker1.id,
      source: 'MOBILE_APP',
      latitude: 36.7379,
      longitude: -119.7869,
      recordedAt: new Date(Date.now() - 3 * 60 * 1000),
      accuracy: 5,
      jobId: jobFresno.id,
    },
  });
  console.log('Seeding complete!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
