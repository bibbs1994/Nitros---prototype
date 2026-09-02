# Nitros / NATI Engineering Standard

## Scope and precedence

This file is the repository-wide engineering standard for Nitros, NATI, Oliver,
office/shop-management features, and future applications or shared services added
under this repository. A more deeply nested `AGENTS.md` may add subsystem-specific
rules, but must not weaken these standards without an explicit task requirement.
System, developer, and current user instructions take precedence.

This is an engineering-governance file, not a release mechanism. Do not change
runtime behavior, build labels, or application versions solely because this file
changes. Treat the latest verified clean baseline as protected behavior. At the
time this standard was introduced, that baseline is Version 10.13.138; confirm the
current baseline from Git and active runtime sources before later work rather than
assuming this sentence is current forever.

## Research before modification

Every meaningful task must begin with enough repository research to understand the
complete affected execution path before editing code. Scale the research to the
risk and reach of the change, but do not infer architecture from filenames or patch
only the nearest visible symptom.

Before implementation:

1. Read all applicable instruction files and the task in full. Check branch, status,
   recent history, and the known-good baseline without disturbing user changes.
2. Map the relevant repository structure, entry points, manifests, documentation,
   shared modules, frontend/backend boundaries, deployment configuration,
   persistence, security controls, tests, and downstream consumers.
3. Trace the real affected path end to end. Depending on the task, this may include
   input, UI/event handling, state, request construction, local server or Vercel,
   provider/model request, response, parsing, normalization, semantic
   interpretation, reconciliation, evidence handoff, persistence, and final UI.
4. Identify the owning files and functions plus every material schema, prompt,
   contract, dependency, caller, consumer, test, and deployment boundary.
5. State the requirement or failure precisely, identify the root cause or evidence
   still needed to establish it, define protected contracts, and choose a
   verification plan before changing behavior.

For a trivial, isolated documentation or typo change, a proportionate inspection is
acceptable, but the affected context and repository status still must be checked.
If failures recur in one subsystem, stop adding compensating special cases. Revisit
the architecture, state contract, schema, normalization, reconciliation, or
ownership boundary and repair the layer that owns the failure.

## Repository orientation

Use this map as an orientation aid, never as a substitute for verifying the current
tree and tracing the task-specific path:

- `index.html` is the active mobile portal and contains the primary UI, application
  state, Oliver diagnostic controller, repair-order workflows, persistence, and
  office/shop-management surfaces.
- `image-analysis-ad.js` owns the browser-side image-analysis adapter, request and
  identity handoff, transport diagnostics, response validation, and UI/Oliver
  delivery.
- `semantic-analyzer-core.mjs` owns the shared server-side semantic and visual
  analysis orchestration, OpenAI request contracts, parsing, normalization,
  reconciliation, evidence promotion, and guaranteed result construction.
- `visual-observation-core.mjs` and `localized-image-crop-core.mjs` own whole-image
  regional observation, visual relationship rules, localized crops, and their
  validation contracts.
- `api/semantic-image-analysis.mjs` is the production Vercel boundary; `server.mjs`
  is the local HTTP boundary. Shared security rules live in
  `backend-http-security.mjs`.
- `dtc-knowledge.js` provides structured diagnostic knowledge and source,
  applicability, evidence, and service-information metadata.
- `support-ticket-repository.mjs`, browser storage, and IndexedDB-backed evidence
  are persistence boundaries. Preserve identity, migration, atomicity, and stale
  state protections.
- `sw.js`, `vercel.json`, and runtime build references participate in deployment,
  caching, and release identity.
- `test/` is the regression system. Select tests by affected contract, not only by
  the file edited.
- Rollback, candidate, old, and downloaded HTML artifacts are historical unless an
  explicit task identifies one as active.
- NATI currently appears as product-planning/notes context rather than a distinct
  runtime module. Any future NATI implementation under this repository inherits
  this standard and should reuse authoritative shared intelligence where suitable.

## Premium engineering priorities

Target the highest practical professional standard appropriate to the product.
Prioritize, in order appropriate to the risk: correctness, reliability, diagnostic
accuracy, safety, data integrity, traceability, maintainability, security,
performance, accessibility, user experience, and regression resistance. Do not
choose a materially weaker implementation solely because it is easier or faster.

Prefer the smallest architecturally correct change. Do not perform unrelated
refactors, formatting, dependency changes, cleanup, regeneration, version bumps,
or release operations. Keep one authoritative owner for each contract or business
rule and remove contradictory paths only when the task and verification justify it.

When Nitros, NATI, Oliver, office systems, educational systems, or future products
need the same rule or intelligence, prefer a shared authoritative core where the
trust boundary and runtime architecture permit it. Do not silently fork diagnostic
logic, vehicle identity, repair-order identity, evidence interpretation, account,
subscription, permission, AI reasoning, or teaching contracts.

## Verification-first change discipline

For every meaningful change:

1. Define the intended behavior and the observable acceptance criteria.
2. Establish the root cause with repository or runtime evidence.
3. Record the affected and protected contracts and dependencies.
4. Implement the smallest coherent repair at the owning layer.
5. Verify the intended behavior and each affected downstream handoff.
6. Run focused tests for the changed contract and regression tests for protected
   behavior; run the broader suite when a shared core or broad surface is affected.
7. Inspect the final diff, status, version references, generated files, and secret
   exposure. Confirm no unrelated file or behavior changed.
8. Report the evidence, residual risks, and anything that remains unverified.

Compilation or disappearance of the immediate symptom is not proof of success.
Preserve verification evidence when practical. Previously proven behavior is a
regression gate: identify it before editing and do not casually trade it away for a
new capability. Add or strengthen regression coverage when practical and relevant.

Do not commit, push, deploy, alter hosted configuration, make a billable provider
request, or increment a version unless the current task authorizes that action.

## Oliver and automotive diagnostic reasoning

Oliver is a professional automotive diagnostic and teaching system, not a generic
chatbot. Diagnostic behavior must:

- separate observations, interpretations, hypotheses, and verified conclusions;
- prioritize observable evidence, causality, component/circuit relationships,
  operating conditions, vehicle applicability, and the least-intrusive useful test;
- calibrate confidence to actual evidence and disclose material uncertainty;
- request the next highest-value verification when evidence is insufficient;
- preserve safety constraints and distinguish verified service information from
  generic or inferred guidance;
- never intentionally encourage parts-cannon diagnosis; and
- require repair confirmation or post-repair verification before presenting a
  fault as resolved.

Where applicable, preserve three useful depths without fragmenting the underlying
logic:

- Professional / quick test: concise test points, expected values or behavior,
  interpretation, and branches.
- Guided diagnostic: step-by-step setup, location, procedure, expected result,
  interpretation, and next branch.
- Teaching / DIY: explain why the test matters, how to validate and use the tool,
  correct probing or test technique, power/load/ground concepts where relevant,
  result interpretation, and the next verification.

The AI assists technicians and students; it does not replace evidence-based
diagnostic reasoning.

## Visual diagnostic reasoning

Inspect and reason over the whole image before choosing a primary finding. Preserve
whole-image and regional coverage through the complete result contract. Do not
anchor on the nearest, largest, easiest, or most visually prominent object.

Actively evaluate diagnostically significant conditions and relationships,
including disconnected or partially seated connectors, open mating interfaces,
missing/loose/broken/displaced components or fasteners, disconnected/split/missing
hoses, damaged wiring, improper routing, leaks, structural damage, and abnormal
component relationships. Connection-state and functional defects generally outrank
incidental cosmetic conditions. Rust, dirt, staining, discoloration, oxidation,
aging, or superficial deterioration must not automatically outrank a visible
functional defect.

Do not infer connection from proximity alone, erase valid partial evidence because
exact identity is uncertain, fabricate a component identity, or report high overall
confidence while critical identity, relationship state, or evidence remains
uncertain. Confidence and prominence must be derived from the complete evidence and
must survive parsing, normalization, reconciliation, promotion, handoff, and render.

## Evidence, identity, and persistence

Maintain traceable relationships among vehicle, repair order/case, technician/user,
source evidence, diagnostic result, AI interpretation, verification, repair, and
post-repair confirmation. Preserve request/run identity, image identity or hashes,
source metadata, timestamps, and provenance where those contracts exist.

Do not silently discard evidence, overwrite material diagnostic state, cross
contaminate cases, or reuse stale results. Treat normalization and downstream
handoffs as data contracts, not cosmetic transformations. For persistence changes,
check compatibility, migration behavior, atomicity, recovery, duplicate handling,
and failure reporting across local storage, IndexedDB, files, and hosted boundaries.

## Explicit failure handling

Failures must be visible, honest, safe, and diagnosable. Do not create silent
failure, misleading success, fake PASS, swallowed exceptions, fabricated
confidence, stale-result reuse, or ambiguous timeout behavior.

Where practical, classify the failed layer: input/validation, UI/event, state,
transport/routing/CORS, serverless/runtime, provider/API, timeout, parsing/schema,
normalization, semantic interpretation, reconciliation, verification, persistence,
or rendering. Preserve enough safe diagnostics to distinguish those layers without
leaking sensitive data.

## Security, privacy, and provider boundaries

Keep secrets, API keys, credentials, customer information, and sensitive
configuration out of source, client bundles, logs, test fixtures, diffs, and
reports. Never print, expose, create, rotate, overwrite, or commit an API key. Use an
existing configured credential only when a task explicitly authorizes provider
access; audit the existing request configuration first and make the minimum
necessary billable call. Never move a server-side secret into the frontend.

Maintain strict client/server trust boundaries, origin and method validation,
content-type and body-size limits, request identity validation, rate limits, safe
public errors, and least-privilege data access. Do not weaken security to simplify
development or testing. Validate deployment environment presence without revealing
secret values.

## Completion report

Conclude meaningful work with a concise, evidence-backed report covering the root
cause or requirement, affected architecture, files and behavior changed, tests and
runtime checks performed, protected regressions checked, final repository status,
and residual risks or unverified claims. Never claim a result that the available
evidence does not establish.
