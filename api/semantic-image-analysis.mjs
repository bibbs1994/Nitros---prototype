import { analyzeSemanticImage } from '../semantic-analyzer-core.mjs';
import { allowedOrigin, clientAddress, enforceRateLimit, parseJsonBody, publicError, validateDeclaredLength, validateJsonContentType } from '../backend-http-security.mjs';
import { buildUsageEvent } from '../ai-usage-ledger.mjs';
import { RedisUsageLedgerRepository } from '../durable-ai-usage-ledger.mjs';

const usageLedger = new RedisUsageLedgerRepository();

export async function persistProviderUsage({ ledger, body, result = {}, error }) {
  const calls = Array.isArray(result?.usageTelemetry?.providerUsage) && result.usageTelemetry.providerUsage.length
    ? result.usageTelemetry.providerUsage
    : [result?.usageTelemetry || {}];
  for (const [upstreamCallIndex, call] of calls.entries()) {
    const telemetry = {
      ...result.usageTelemetry,
      ...call,
      providerUsage: call.providerUsage ?? null,
      upstreamCallIndex,
      models: call.model ? [call.model] : [],
      requestCount: 1,
      tokens: {
        inputTokens: call.inputTokens,
        cachedInputTokens: call.cachedInputTokens,
        cacheWriteInputTokens: call.cacheWriteInputTokens,
        outputTokens: call.outputTokens,
        reasoningTokens: call.reasoningTokens,
        totalTokens: call.totalTokens
      }
    };
    await ledger.record(buildUsageEvent({ body, result: { ...result, usageTelemetry: telemetry }, error }));
  }
  return calls.length;
}

export async function persistProviderUsageSafely({ ledger, body, result, error, diagnostic, logger = console }) {
  if (ledger.configured === false) {
    diagnostic.usageLedgerWriteStatus = 'UNCONFIGURED';
    diagnostic.usageLedgerProviderEventCount = 0;
    return diagnostic.usageLedgerWriteStatus;
  }
  try {
    diagnostic.usageLedgerProviderEventCount = await persistProviderUsage({ ledger, body, result, error });
    diagnostic.usageLedgerWriteStatus = 'PERSISTED';
  } catch (error) {
    diagnostic.usageLedgerWriteStatus = 'FAILED';
    diagnostic.usageLedgerWriteError = error?.code || 'LEDGER_STORAGE_FAILED';
    logger.error('AI usage ledger persistence failure.', { errorCode: diagnostic.usageLedgerWriteError });
  }
  return diagnostic.usageLedgerWriteStatus;
}

function safeServerDiagnostic(diagnostic = {}) {
  const allowed = ['diagnosticVersion','success','stage','requestId','requestReceived','methodAccepted','requestBodyParsed','imagePayloadFound','imagePayloadNonEmpty','imagePayloadValid','imageMimeType','imageByteLength','imageHashShort','payloadImageCount','openaiCredentialConfigured','openaiRequestConstructed','openaiRequestAttempted','openaiResponseReceived','openaiResponseOk','openaiResponseParsed','openaiHttpStatus','openaiElapsedMs','openaiModel','openaiApiType','openaiReasoningEffort','openaiReasoningMode','openaiImageDetail','originalImageDimensions','transmittedImageDimensions','imageRecompressed','supplementalImageRegions','finalPositiveVisibleFindings','contradictionReconciliationResult','semanticOutputPresent','semanticObjectsReturned','componentIdentificationAttempted','componentIdentificationSkipped','componentResponseReceived','componentResponseOk','componentResponseParsed','componentHttpStatus','componentElapsedMs','componentResponseStatus','componentIncompleteReason','componentResultPresent','componentConfidenceNormalized','componentConfidenceStatus','componentStatus','componentResultSource','componentFallbackApplied','rawComponentResult','normalizedComponentName','normalizedComponentConfidence','normalizedComponentState','normalizedVehicleArea','componentErrorCategory','componentErrorMessage','visualConditionInspectionAttempted','visualConditionInspectionSkipped','visualConditionResponseReceived','visualConditionResponseOk','visualConditionResponseParsed','visualConditionHttpStatus','visualConditionElapsedMs','visualConditionResultPresent','visualConditionStatus','visualConditionConfidenceNormalized','visualConditionErrorCategory','visualConditionErrorMessage','visualConditionFirstRequestTimeout','visualConditionRetryStarted','visualConditionRetrySuccess','visualConditionRetryFailure','visualConditionMalformedResponse','visualConditionConsistencyCorrections','wiringDiagramAnalysisAttempted','wiringDiagramAnalysisSkipped','wiringDiagramResponseReceived','wiringDiagramResponseOk','wiringDiagramResponseParsed','wiringDiagramHttpStatus','wiringDiagramElapsedMs','wiringDiagramResultPresent','wiringDiagramStatus','wiringDiagramErrorMessage','documentExtractionAttempted','documentExtractionSkipped','documentExtractionResponseReceived','documentExtractionResponseOk','documentExtractionResponseParsed','documentExtractionHttpStatus','documentExtractionElapsedMs','documentExtractionResultPresent','documentExtractionStatus','documentExtractionMissingFields','documentExtractionErrorMessage','errorCategory','errorType','errorCode','errorMessage','responseReturned'];
  allowed.push('visualConditionTrace','visualConditionStarted','visualConditionFirstAttemptTimeoutMs','visualConditionRetryTimeoutMs','visualConditionFirstByteReceived','visualConditionFirstByteMs','visualConditionAttempt','visualConditionParseStarted','visualConditionParseSucceeded','visualConditionParseFailed','visualConditionParseMs','visualConditionTimedOut','visualConditionAborted','visualConditionAbortAttempt','visualConditionPartialEvidencePreserved','visualConditionIncompleteResponse','visualConditionResponseStatus','visualConditionIncompleteReason','visualConditionFirstResponseStatus','visualConditionFirstIncompleteReason','visualConditionRetryResponseStatus','visualConditionRetryIncompleteReason','visualConditionCoreResultSource','visualConditionTotalMs','visualConditionStructuredResult','analyzerTotalMs','analyzerBudgetMs','responseReturnReserveMs');
  allowed.push('usageLedgerWriteStatus','usageLedgerProviderEventCount','usageLedgerWriteError');
  const executionStages = ['rawVisualObservationRequest','rawVisualObservationResponse','objectInventory','physicalRelationshipAnalysis','electricalConnectionStateAnalysis','abnormalStateDetection','rawVisualObservationErrorMessage','localizedVisualVerification','localizedVisualInspections','localizedCandidateLimit','localizedVisualFailureReason','vehicleAreaRelationshipAttempted','vehicleAreaRelationshipSkipped','vehicleAreaRelationshipSkipReason','vehicleAreaRelationshipResponseReceived','vehicleAreaRelationshipResponseOk','vehicleAreaRelationshipHttpStatus','vehicleAreaRelationshipElapsedMs','vehicleAreaRelationshipResultPresent','vehicleAreaRelationshipStatus','relationshipDiagnosticStatus','relationshipOutcome','vehicleAreaRelationshipConfidenceNormalized','vehicleAreaRelationshipFallbackApplied','vehicleAreaRelationshipErrorMessage','vehicleAreaSource','vehicleAreaReason','relationshipSource','relationshipReason','relationshipFindingCount','photoGuidanceSource','photoGuidanceReason','vehicleContextValidation','vehicleContextMismatchStatus','vehicleContextProvided','vehicleContextMismatchBlocked','reconciliationReasonCode','crossFindingConsistency','crossFindingConflictsResolved','crossFindingRejectionReasons','finalEvidencePromotion','visibleDefectPromotedCount','promotedVisibleDefectCount'];
  return Object.fromEntries([...allowed, ...executionStages].filter(key => diagnostic[key] !== undefined).map(key => [key, diagnostic[key]]));
}

export default async function handler(request, response) {
  const diagnostic = { diagnosticVersion: '10.13.144', success: false, stage: 'A_REQUEST_RECEIVED', requestReceived: true, methodAccepted: false, requestBodyParsed: false, imagePayloadFound: false, imagePayloadValid: false, payloadImageCount: 0, openaiCredentialConfigured: null, openaiRequestConstructed: false, openaiRequestAttempted: false, openaiResponseReceived: false, openaiResponseOk: false, openaiResponseParsed: false, semanticOutputPresent: false, componentIdentificationAttempted: false, componentResultPresent: false, visualConditionInspectionAttempted: false, visualConditionResultPresent: false, wiringDiagramAnalysisAttempted: false, wiringDiagramResultPresent: false, documentExtractionAttempted: false, documentExtractionResultPresent: false, responseReturned: false };
  let body;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = request.headers?.origin;
  if (!allowedOrigin(origin)) return response.status(403).json({ error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' });
  response.setHeader('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    response.setHeader('Access-Control-Max-Age', '600');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }
  diagnostic.stage = 'B_HTTP_METHOD_ACCEPTED';
  diagnostic.methodAccepted = true;
  try {
    enforceRateLimit(`${origin}|${clientAddress(request.headers)}`);
    validateJsonContentType(request.headers?.['content-type']);
    validateDeclaredLength(request.headers?.['content-length']);
    body = parseJsonBody(request.body);
    diagnostic.stage = 'C_REQUEST_BODY_PARSED';
    diagnostic.requestBodyParsed = true;
    diagnostic.requestId = typeof body?.transactionId === 'string' ? body.transactionId : 'invalid';
    diagnostic.imagePayloadFound = typeof body?.imageBase64 === 'string' && body.imageBase64.length > 0;
    const result = await analyzeSemanticImage(body, { diagnostic, enableVisualObservation: true });
    await persistProviderUsageSafely({ ledger: usageLedger, body, result, diagnostic });
    diagnostic.stage = 'L_RESPONSE_RETURNED';
    diagnostic.success = true;
    diagnostic.responseReturned = true;
    return response.status(200).json({ ...result, serverDiagnostic: safeServerDiagnostic(diagnostic) });
  } catch (error) {
    const failure = publicError(error);
    const failedDiagnostic = error?.serverDiagnostic || diagnostic;
    if (body && diagnostic.requestBodyParsed && diagnostic.requestId !== 'invalid') {
      await persistProviderUsageSafely({ ledger: usageLedger, body, result: { usageTelemetry: { model: failedDiagnostic.openaiModel || null, reasoningEffort: failedDiagnostic.openaiReasoningEffort || null, providerUsage: failedDiagnostic.providerUsageTelemetry || [] } }, error, diagnostic: failedDiagnostic });
    }
    if (!failedDiagnostic.errorCategory) failedDiagnostic.errorCategory = error?.code || 'VERCEL_REQUEST_ERROR';
    if (!failedDiagnostic.errorMessage) failedDiagnostic.errorMessage = error?.publicMessage || failure.body.error;
    if (failedDiagnostic.stage === 'B_HTTP_METHOD_ACCEPTED') failedDiagnostic.stage = 'C_REQUEST_BODY_PARSE_FAILED';
    failedDiagnostic.responseReturned = true;
    if (failure.status === 429) response.setHeader('Retry-After', '60');
    return response.status(failure.status).json({ ...failure.body, serverDiagnostic: safeServerDiagnostic(failedDiagnostic) });
  }
}
