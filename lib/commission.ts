import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type CommissionPlanType =
  | 'PERCENT_REVENUE'
  | 'PERCENT_GROSS_PROFIT'
  | 'FLAT_PER_JOB'
  | 'FLAT_PER_TASK'
  | 'PRODUCTION_RATE'
  | 'TIERED';

export type CommissionEarnedEvent =
  | 'JOB_COMPLETED'
  | 'JOB_APPROVED'
  | 'INVOICE_GENERATED'
  | 'INVOICE_PAID';

export type Tier = { upTo: number | null; percent: number }; // upTo in cents (null = infinity)

export type PlanConfig = {
  percent?: number; // e.g. 4 = 4%
  flatAmount?: number; // cents (FLAT_PER_JOB)
  flatPerTask?: number; // cents (FLAT_PER_TASK)
  ratePerUnit?: number; // cents (PRODUCTION_RATE, per quantity unit)
  tiers?: Tier[]; // TIERED on revenue
  primeOverrides?: Record<string, Partial<PlanConfig>>; // by primeContractorId
  taskOverrides?: Record<string, Partial<PlanConfig>>; // by taskTypeId
};

export type CommissionContext = {
  revenue: number; // cents
  grossProfit: number; // cents
  taskCount: number;
  totalQuantity: number;
  primeContractorId: string;
  tasks: { taskTypeId: string; quantity: number; billableAmount: number; costAmount: number }[];
};

export type CommissionResult = { basisAmount: number; commissionAmount: number };

function round(n: number): number {
  return Math.round(n);
}

/** Merge a prime-specific override on top of the base config. */
function effectiveConfig(config: PlanConfig, primeContractorId: string): PlanConfig {
  const override = config.primeOverrides?.[primeContractorId];
  return override ? { ...config, ...override } : config;
}

/**
 * Pure, deterministic commission calculation. All money in integer cents.
 * Never mutates inputs; safe to snapshot the (planType, config) that produced a result.
 */
export function calculateCommission(
  planType: CommissionPlanType,
  rawConfig: PlanConfig,
  ctx: CommissionContext,
): CommissionResult {
  const config = effectiveConfig(rawConfig || {}, ctx.primeContractorId);

  switch (planType) {
    case 'PERCENT_REVENUE': {
      const pct = config.percent ?? 0;
      return { basisAmount: ctx.revenue, commissionAmount: round((ctx.revenue * pct) / 100) };
    }
    case 'PERCENT_GROSS_PROFIT': {
      const pct = config.percent ?? 0;
      const basis = Math.max(0, ctx.grossProfit);
      return { basisAmount: ctx.grossProfit, commissionAmount: round((basis * pct) / 100) };
    }
    case 'FLAT_PER_JOB': {
      return { basisAmount: ctx.revenue, commissionAmount: config.flatAmount ?? 0 };
    }
    case 'FLAT_PER_TASK': {
      // per-task flat, allowing task-type-specific overrides
      let total = 0;
      for (const t of ctx.tasks) {
        const ov = config.taskOverrides?.[t.taskTypeId];
        const flat = ov?.flatPerTask ?? config.flatPerTask ?? 0;
        total += flat;
      }
      return { basisAmount: ctx.revenue, commissionAmount: total };
    }
    case 'PRODUCTION_RATE': {
      // rate per unit of quantity, allowing task-type-specific rate overrides
      let total = 0;
      for (const t of ctx.tasks) {
        const ov = config.taskOverrides?.[t.taskTypeId];
        const rate = ov?.ratePerUnit ?? config.ratePerUnit ?? 0;
        total += round(rate * (t.quantity || 0));
      }
      return { basisAmount: ctx.revenue, commissionAmount: total };
    }
    case 'TIERED': {
      const tiers = (config.tiers ?? []).slice().sort((a, b) => {
        const av = a.upTo ?? Number.MAX_SAFE_INTEGER;
        const bv = b.upTo ?? Number.MAX_SAFE_INTEGER;
        return av - bv;
      });
      let remaining = ctx.revenue;
      let prevCap = 0;
      let total = 0;
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const cap = tier.upTo ?? Number.MAX_SAFE_INTEGER;
        const band = Math.max(0, Math.min(cap, ctx.revenue) - prevCap);
        const applied = Math.min(band, remaining);
        total += round((applied * (tier.percent ?? 0)) / 100);
        remaining -= applied;
        prevCap = cap;
      }
      return { basisAmount: ctx.revenue, commissionAmount: total };
    }
    default:
      return { basisAmount: 0, commissionAmount: 0 };
  }
}

/** Whether the job's current state satisfies a plan's earned event. */
export function isEarned(earnedEvent: CommissionEarnedEvent, job: { status: string; invoiceStatus?: string | null }): boolean {
  switch (earnedEvent) {
    case 'JOB_COMPLETED':
      return ['UNDER_REVIEW', 'APPROVED', 'INVOICED', 'CLOSED'].includes(job.status);
    case 'JOB_APPROVED':
      return ['APPROVED', 'INVOICED', 'CLOSED'].includes(job.status);
    case 'INVOICE_GENERATED':
      return ['INVOICED', 'CLOSED'].includes(job.status) || job.invoiceStatus === 'SENT' || job.invoiceStatus === 'PAID';
    case 'INVOICE_PAID':
      return job.invoiceStatus === 'PAID';
    default:
      return false;
  }
}

export type Prisma_ = Prisma;
