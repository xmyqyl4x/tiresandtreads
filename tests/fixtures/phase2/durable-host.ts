import { createPilotRenderer } from '../../../packages/integrations/src/pilot-renderer.ts';
import { deriveLocalPhase2Keys } from '../../../packages/integrations/src/local-encrypted-objects.ts';
import { readFile } from 'node:fs/promises';
import {
  createPhase2LocalHost,
  type Phase2LocalHostOptions,
} from '../../../packages/integrations/src/phase2-local-host.ts';
import {
  bindPhase2LocalServices,
  type Phase2LocalPorts,
} from '../../../packages/integrations/src/phase2-local-bindings.ts';
import { createStructuredAnalysisProvider } from '../../../packages/integrations/src/analysis-provider.ts';
import { createStructuredGenericProvider } from '../../../packages/integrations/src/generic-analysis-provider.ts';
import { createPhotoExtractionProvider } from '../../../packages/integrations/src/photo-provider.ts';
import { createPhotoScanner } from '../../../packages/integrations/src/photo-scanner.ts';
import { createIsolatedPhotoCodec } from '../../../packages/integrations/src/photo-codec.ts';
import { createAnalysisReportRenderer } from '../../../packages/integrations/src/analysis-delivery-renderer.ts';
import { createFixtureReportRenderer } from '../../../packages/integrations/src/delivery-renderer.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import { partnerPrincipal } from '../../../packages/domain/src/partner-policy.ts';
import { fail, ok } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
export interface DurableHostConfig {
  urls: Phase2LocalHostOptions['urls'];
  materialFile: string;
  objectsDirectory: string;
  journalDirectory: string;
  privacyJournalDirectory: string;
  privacyPolicyVersion: string;
  policy: Phase2LocalPorts['partnerPolicy'];
  pilotPolicy: Omit<Phase2LocalPorts['pilot']['policy'], 'creditUnits'> & { creditUnits: string };
  contactPolicy: Phase2LocalPorts['contactPolicy'];
  deliveryPolicy: Phase2LocalPorts['delivery']['policy'];
  parserRevision: string;
  rendererHash: string;
  sessions: Record<string, unknown>;
  holdReport?: boolean;
  pilotRendererHash?: string;
}
export async function durableHostOptions(
  path: string,
  providerStarted: () => void = () => undefined,
) {
  const raw = await readFile(path, 'utf8');
  if (raw.length > 65536) throw Error('Synthetic local config bound');
  const c = JSON.parse(raw) as DurableHostConfig;
  const verify = async (handle: string) => {
    const raw = await readFile(path, 'utf8');
    if (raw.length > 65536) return fail(failure('forbidden'));
    const current = JSON.parse(raw) as DurableHostConfig,
      p = partnerPrincipal(current.sessions[handle], Date.now());
    return p.ok ? ok(p.value) : fail(failure('forbidden'));
  };
  const authority = {
    verify,
    async verifyStaff(handle: string) {
      const p = await verify(handle);
      return p.ok && p.value.staffId
        ? ok({
            subject: p.value.subject,
            staffId: p.value.staffId,
            mfaAt: p.value.mfaAt,
            expiresAt: p.value.expiresAt,
          })
        : fail(failure('forbidden'));
    },
  };
  const options: Phase2LocalHostOptions = {
    mode: 'local-opt-in',
    effects: 'synthetic-injected',
    urls: c.urls,
    otherConnections: 70,
    reserve: 4,
    materialFile: c.materialFile,
    objectsDirectory: c.objectsDirectory,
    bind: async (context) =>
      bindPhase2LocalServices(context, {
        pilot: {
          policy: { ...c.pilotPolicy, creditUnits: BigInt(c.pilotPolicy.creditUnits) },
          provider: {
            name: 'fixture',
            fixture: true,
            send: async () => ({ outcome: 'uncertain', messageId: null }),
          },
          renderer: createPilotRenderer({
            report: createFixtureReportRenderer(c.pilotRendererHash ?? 'd'.repeat(64)),
            fixture: true,
            preferences: (send) => 'https://preview.example.invalid/unsubscribe?cap=' + send,
            senderName: 'SYNTHETIC LOCAL ONLY',
            postalAddress: ['SYNTHETIC ADDRESS; NOT A LIVE SENDER'],
          }),
        },
        bucket: c.policy.assetBucket,
        authority,
        partnerPolicy: c.policy,
        contactPolicy: c.contactPolicy,
        report: {
          noticeVersion: 'ai-processing-v1',
          provider: createStructuredAnalysisProvider({
            async send(input) {
              if (c.holdReport) {
                providerStarted();
                await new Promise(() => undefined);
              }
              return {
                state: 'complete',
                output: {
                  schema: 1,
                  summary: 'report_facts',
                  claims: input.packet.claims.map((x) => ({ id: x.id, citations: x.citations })),
                  limitations: ['source_limits'],
                  questions: ['verify_fitment'],
                },
                providerRequestId: 'synthetic-durable-only',
                inputTokens: 10n,
                outputTokens: 10n,
                costMinor: 5n,
              };
            },
          }),
        },
        generic: {
          provider: createStructuredGenericProvider({
            async send(input) {
              return {
                state: 'complete',
                output: {
                  schema: 1,
                  factIds: [input.packet.fact.id],
                  questions: ['verify_fitment'],
                },
                providerRequestId: 'synthetic-generic-only',
                inputTokens: 10n,
                outputTokens: 10n,
                costMinor: 5n,
              };
            },
          }),
        },
        photo: {
          noticeVersion: 'photo-processing-v1',
          codec: createIsolatedPhotoCodec(),
          scanner: createPhotoScanner({ scan: async () => 'clean' }),
          provider: createPhotoExtractionProvider({
            async send() {
              return {
                state: 'complete',
                output: {
                  schema: 1,
                  fields: [
                    {
                      field: 'tire_size',
                      rawText: '225/65R17',
                      value: '225/65R17',
                      quality: 'clear',
                      unknownReason: null,
                      region: null,
                    },
                    {
                      field: 'dot_tin',
                      rawText: 'DOT ABC123',
                      value: 'DOT ABC123',
                      quality: 'clear',
                      unknownReason: null,
                      region: null,
                    },
                  ],
                },
                providerRequestId: 'synthetic-photo-only',
                inputTokens: 10n,
                outputTokens: 10n,
                costMinor: 5n,
              };
            },
          }),
        },
        delivery: {
          policy: c.deliveryPolicy,
          renderer: createAnalysisReportRenderer(
            createFixtureReportRenderer('d'.repeat(64)),
            c.rendererHash,
          ),
          provider: {
            fixture: true,
            name: 'fixture',
            send: async () => ({ outcome: 'uncertain', messageId: null }),
          },
        },
        privacy: {
          policyVersion: c.privacyPolicyVersion,
          journal: createFilePrivacyJournal(
            c.privacyJournalDirectory,
            createPrivacyCrypto(
              context.material.current,
              deriveLocalPhase2Keys(context.material, 'privacy-journal'),
            ),
          ),
        },
        erasure: {
          journal: createFilePrivacyJournal(
            c.journalDirectory,
            createPrivacyCrypto(
              context.material.current,
              deriveLocalPhase2Keys(context.material, 'privacy-journal'),
            ),
          ),
          mail: { verify: async () => undefined, erase: async () => 'not_stored' },
          provider: { erase: async () => 'not_stored' },
        },
        csvParserRevision: c.parserRevision,
      }),
  };
  return options;
}
export async function openDurableHost(path: string, providerStarted: () => void = () => undefined) {
  return createPhase2LocalHost(await durableHostOptions(path, providerStarted));
}
