// Orchestrates an operator-triggered analysis:
//   load sources -> preprocess -> call OpenAI (strict schema) -> zod validate ->
//   deterministic business rules -> duplicate detection -> persist DRAFT.
//
// OpenAI NEVER creates records here. On failure the source rows and any prior
// draft are preserved (only a successful run replaces the draft), so retries are
// safe and idempotent.
import { prisma } from '@/lib/prisma';
import { getObjectBytes } from '@/lib/s3';
import { writeAudit } from '@/lib/audit';
import { getAiIntakeSettingsRaw, getDecryptedApiKey, recordAiSuccess, recordAiError } from './settings';
import { getScopedRules, approvedTermSet } from './rules';
import { AI_INTAKE_SYSTEM_PROMPT, buildContextMessage, type IntakeContextMeta } from './prompt';
import { preparePastedText, prepareFileSource, type SourceKind, MAX_INTAKE_FILE_BYTES } from './extract';
import { runExtraction, type OpenAiMessage, type OpenAiContentPart } from './openai';
import { AiIntakeResponseSchema, AI_INTAKE_SCHEMA_VERSION } from './schema';
import { applyBusinessRules } from './business';
import { findDuplicates } from './duplicate';
import { claimForAnalysis, IntakeStateLockError } from './state-lock';

export type ActorMeta = { id: string; email: string; role: string };
export type ReqMeta = { ipAddress?: string | null; userAgent?: string | null };

export class AiIntakeError extends Error {}

// Raised internally when the analysis run discovers, at finalization time, that
// it no longer owns the intake (status is no longer ANALYZING - e.g. the state
// was changed by another authoritative mutator between claim and finalize).
// Its result is discarded WITHOUT overwriting the newer state.
class AnalysisOwnershipLostError extends Error {}

export async function analyzeIntake(intakeId: string, actor: ActorMeta, reqMeta: ReqMeta = {}) {
  const settingsRow = await getAiIntakeSettingsRaw();
  if (!settingsRow || !settingsRow.enabled) throw new AiIntakeError('AI intake is not enabled');
  const apiKey = getDecryptedApiKey(settingsRow);
  if (!apiKey) throw new AiIntakeError('No OpenAI API key configured');

  // Concurrency control: atomically CLAIM the intake for analysis BEFORE reading
  // its sources / pasted text. This guarantees (a) two concurrent analyses can
  // never both run against the same intake (the loser matches zero rows and is
  // refused), and (b) the input set we analyze is frozen - draft/source edits
  // fail closed while the intake is ANALYZING. Only one caller moves an
  // analyzable intake -> ANALYZING.
  try {
    await prisma.$transaction(async (tx) => {
      await claimForAnalysis(tx, intakeId);
    });
  } catch (e) {
    if (e instanceof IntakeStateLockError) throw new AiIntakeError(e.message);
    throw e;
  }

  await writeAudit({
    actor, action: 'ai_intake.analysis_started', entityType: 'AiWorkIntake', entityId: intakeId,
    metadata: { model: settingsRow.normalModel }, ...reqMeta,
  });

  try {
    // We now own the intake (status ANALYZING). Read the input set we own.
    const intake = await prisma.aiWorkIntake.findUnique({
      where: { id: intakeId },
      include: { sources: true },
    });
    if (!intake) throw new AiIntakeError('Intake not found');

    // Prime/Project metadata (approved, trusted context).
    const prime = await prisma.primeContractor.findUnique({
      where: { id: intake.primeContractorId },
      select: { companyName: true },
    });
    const project = intake.projectId
      ? await prisma.project.findUnique({
          where: { id: intake.projectId },
          select: { projectCode: true, projectName: true },
        })
      : null;
    const rules = await getScopedRules(intake.primeContractorId, intake.projectId);

    // Build the user content: pasted text first, then each file source.
    const userParts: OpenAiContentPart[] = [];
    const sourceSentInfo: { id: string; sentToAi: boolean; info: Record<string, unknown> }[] = [];
    let hasHardVisual = false;

    if (intake.pastedText && intake.pastedText.trim()) {
      const prepared = preparePastedText('pasted email/text', intake.pastedText);
      userParts.push(...prepared.parts);
    }

    for (const src of intake.sources) {
      if (!src.storagePath) {
        sourceSentInfo.push({ id: src.id, sentToAi: false, info: { skipped: 'no storage path' } });
        continue;
      }
      const bytes = await getObjectBytes(src.storagePath, MAX_INTAKE_FILE_BYTES);
      if (!bytes) {
        sourceSentInfo.push({ id: src.id, sentToAi: false, info: { skipped: 'unreadable or too large' } });
        continue;
      }
      const prepared = await prepareFileSource({
        kind: src.kind as SourceKind,
        filename: src.originalFilename || 'source',
        contentType: src.contentType,
        bytes,
      });
      if (src.kind === 'pdf' || src.kind === 'image' || src.kind === 'drawing') hasHardVisual = true;
      userParts.push(...prepared.parts);
      sourceSentInfo.push({ id: src.id, sentToAi: prepared.sentToAi, info: prepared.info });
    }

    if (!userParts.length) throw new AiIntakeError('No analyzable content in this intake');

    const meta: IntakeContextMeta = {
      primeName: prime?.companyName ?? 'Unknown prime',
      projectCode: project?.projectCode ?? null,
      projectName: project?.projectName ?? null,
      rules,
    };
    const messages: OpenAiMessage[] = [
      { role: 'system', content: [{ type: 'input_text', text: AI_INTAKE_SYSTEM_PROMPT }] },
      { role: 'developer', content: [{ type: 'input_text', text: buildContextMessage(meta) }] },
      { role: 'user', content: userParts },
    ];

    // First pass. Hard visual sources (drawings/PDF) prefer the stronger model.
    let call = await runExtraction({
      apiKey,
      apiBase: settingsRow.apiBase, // Blocker 1: validated + pinned to official endpoint server-side
      normalModel: settingsRow.normalModel,
      fallbackModel: settingsRow.fallbackModel,
      messages,
      preferFallback: hasHardVisual,
    });
    if (!call.ok || !call.raw) throw new AiIntakeError(call.error || 'OpenAI request failed');

    // Parse + zod validate. On invalid JSON, escalate once to the fallback model.
    let parsed = safeParse(call.raw);
    let validated = parsed ? AiIntakeResponseSchema.safeParse(parsed) : null;
    if ((!validated || !validated.success) && !call.usedFallback) {
      call = await runExtraction({
        apiKey,
        apiBase: settingsRow.apiBase, // Blocker 1: validated + pinned to official endpoint server-side
        normalModel: settingsRow.fallbackModel, // force stronger model
        fallbackModel: settingsRow.fallbackModel,
        messages,
      });
      if (call.ok && call.raw) {
        parsed = safeParse(call.raw);
        validated = parsed ? AiIntakeResponseSchema.safeParse(parsed) : null;
      }
    }
    if (!validated || !validated.success) {
      throw new AiIntakeError('Model output failed schema validation');
    }

    // Deterministic business layer (independent of the model's judgement).
    const business = applyBusinessRules(validated.data, { approvedTerms: approvedTermSet(rules) });

    // Duplicate detection against existing open work orders.
    const dupHits = await findDuplicates({
      primeContractorId: intake.primeContractorId,
      projectId: intake.projectId,
      deviceIds: business.items.map((i) => i.device_id),
    });
    const dupByDevice = new Map<string, string>();
    for (const h of dupHits) if (!dupByDevice.has(h.deviceId)) dupByDevice.set(h.deviceId, h.jobId);

    const anyReview = business.items.some((i) => i.requires_review) || dupHits.length > 0;
    const modelUsed = call.modelUsed ?? settingsRow.normalModel;

    // Persist atomically. Only a SUCCESSFUL run that STILL OWNS the intake
    // replaces the prior draft/items. Defense-in-depth: re-assert ownership as
    // the first statement in the tx via a conditional updateMany on
    // status='ANALYZING'. If this run no longer owns the intake (0 rows matched),
    // abort the whole transaction (rolling back the deleteMany) and discard the
    // result rather than silently overwriting a newer committed state.
    await prisma.$transaction(async (tx) => {
      const owned = await tx.aiWorkIntake.updateMany({
        where: { id: intakeId, status: 'ANALYZING' },
        data: { revision: { increment: 1 } },
      });
      if (owned.count !== 1) {
        throw new AnalysisOwnershipLostError('Analysis result discarded: intake is no longer analyzing');
      }
      await tx.aiIntakeItem.deleteMany({ where: { intakeId } });
      await tx.aiWorkIntake.update({
        where: { id: intakeId },
        data: {
          status: anyReview ? 'NEEDS_REVIEW' : 'READY',
          model: settingsRow.normalModel,
          modelUsed,
          usedFallback: call.usedFallback,
          schemaVersion: AI_INTAKE_SCHEMA_VERSION,
          structuredDraft: business.response as any,
          priorityRawText: business.response.priority_raw_text ?? null,
          priorityOrder: (business.response.priority_order ?? []) as any,
          warnings: business.warnings as any,
          confidenceSummary: business.confidenceSummary as any,
          analyzedAt: new Date(),
          error: null,
        },
      });
      for (let i = 0; i < business.items.length; i++) {
        const it = business.items[i];
        const dupJobId = dupByDevice.get(it.device_id) ?? null;
        await tx.aiIntakeItem.create({
          data: {
            intakeId,
            orderIndex: i,
            deviceId: it.device_id,
            proposedType: it.proposed_type,
            routeSection: it.route_section,
            instructions: it.instructions,
            reentryRequired: it.reentry_required,
            reentryReason: it.reentry_reason,
            partialWorkAllowed: it.partial_work_allowed,
            blockedDependency: it.blocked_dependency,
            dependencies: (it.dependencies ?? []) as any,
            confidence: it.confidence,
            requiresReview: it.requires_review || !!dupJobId,
            reviewReason: dupJobId
              ? `${it.review_reason ? it.review_reason + '; ' : ''}Possible duplicate of existing work order`
              : it.review_reason,
            sourceReference: it.source_reference,
            possibleDuplicate: !!dupJobId,
            duplicateOfJobId: dupJobId,
            proposedBillingCode: it.proposed_billing_code_suggestion,
          },
        });
      }
      for (const s of sourceSentInfo) {
        await tx.aiIntakeSource.update({
          where: { id: s.id },
          data: { sentToAi: s.sentToAi, extractionInfo: s.info as any },
        });
      }
    });

    await recordAiSuccess(modelUsed);
    await writeAudit({
      actor, action: 'ai_intake.analysis_completed', entityType: 'AiWorkIntake', entityId: intakeId,
      metadata: {
        modelUsed, usedFallback: call.usedFallback, items: business.items.length,
        review: business.confidenceSummary.review, duplicates: dupHits.length,
      },
      ...reqMeta,
    });

    return { status: anyReview ? 'NEEDS_REVIEW' : 'READY', items: business.items.length };
  } catch (e) {
    // Ownership lost at finalization: another authoritative mutator changed the
    // state after our claim. Do NOT overwrite the newer state (no FAILED write,
    // no error record) - simply discard this run's result.
    if (e instanceof AnalysisOwnershipLostError) {
      throw new AiIntakeError(e.message);
    }
    const msg = e instanceof Error ? e.message : 'Analysis failed';
    // Preserve sources + any prior draft; only flag this run as failed. The
    // write is conditioned on status='ANALYZING' so a genuine failure can only
    // flip the intake we still own to FAILED - it can never clobber a state that
    // a concurrent mutator committed (e.g. REJECTED) after our claim.
    await prisma.aiWorkIntake.updateMany({ where: { id: intakeId, status: 'ANALYZING' }, data: { status: 'FAILED', error: msg.slice(0, 500) } }).catch(() => {});
    await recordAiError(msg);
    await writeAudit({
      actor, action: 'ai_intake.analysis_failed', entityType: 'AiWorkIntake', entityId: intakeId,
      metadata: { error: msg.slice(0, 300) }, ...reqMeta,
    }).catch(() => {});
    throw e instanceof AiIntakeError ? e : new AiIntakeError(msg);
  }
}

function safeParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
