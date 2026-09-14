// Concurrency-safe document numbering (requirement G).
//
// Numbers are allocated from a monotonic DocumentCounter row using an atomic
// { increment: 1 } update inside a transaction. The returned value is unique by
// construction even under concurrent allocation. Callers additionally retry the
// CREATE on a P2002 unique-constraint violation, which covers the edge case of a
// pre-existing legacy row occupying an allocated number without needing to
// pre-scan live data. Numbers are stable once assigned (never reused/renumbered).

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type CounterKey = 'ESTIMATE' | 'QUOTE' | 'INVOICE' | 'WORKORDER';

const DEFAULTS: Record<CounterKey, { prefix: string; padding: number }> = {
  ESTIMATE: { prefix: 'EST', padding: 5 },
  QUOTE: { prefix: 'Q', padding: 5 },
  INVOICE: { prefix: 'INV', padding: 5 },
  WORKORDER: { prefix: 'WO', padding: 5 },
};

type Tx = Prisma.TransactionClient | PrismaClient;

function formatNumber(prefix: string, value: number, padding: number): string {
  return `${prefix}-${String(value).padStart(padding, '0')}`;
}

/**
 * Atomically allocate the next document number for the given counter.
 * Safe to call inside an existing transaction (pass the tx client) or
 * standalone (uses the shared prisma client).
 */
export async function allocateNumber(key: CounterKey, client: Tx = prisma): Promise<string> {
  const def = DEFAULTS[key];
  // Ensure the counter row exists (idempotent) then atomically increment.
  const updated = await client.documentCounter.upsert({
    where: { key },
    // create starts at 1 so the first allocated number is <prefix>-00001
    create: { key, prefix: def.prefix, value: 1, padding: def.padding },
    update: { value: { increment: 1 } },
  });
  return formatNumber(updated.prefix, updated.value, updated.padding);
}

export class NumberAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberAllocationError';
  }
}

/**
 * Allocate a number and run `create` with it, retrying on a unique-violation
 * (P2002) up to `maxAttempts` times. This makes creation robust against both
 * concurrent allocation and any pre-existing rows that already own a number.
 *
 * The `create` callback receives the freshly allocated number and must perform
 * the actual row insertion (returning the created entity).
 */
export async function createWithNumber<T>(
  key: CounterKey,
  create: (documentNumber: string) => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const documentNumber = await allocateNumber(key);
    try {
      return await create(documentNumber);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Number collided with an existing row — allocate the next and retry.
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new NumberAllocationError(
    `Failed to allocate a unique ${key} number after ${maxAttempts} attempts`
  );
}
