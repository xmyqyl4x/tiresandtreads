import { z, p2Uuid, p2Revision } from '../../../../../packages/contracts/src/phase2-wire.ts';
export function reportReference(f: FormData) {
  const report = p2Uuid.parse(f.get('report')),
    raw = z
      .string()
      .regex(/^[1-9][0-9]{0,9}$/)
      .parse(f.get('version'));
  return { report, version: z.number().int().min(1).max(2147483647).parse(Number(raw)) };
}
export function deliverySelection(choice: string, revision: string | null) {
  return choice === 'artifact'
    ? { attachmentRevision: p2Revision.parse(revision), fallback: null }
    : {
        attachmentRevision: null,
        fallback: z.enum(['not_requested', 'unavailable', 'declined', 'expired']).parse(choice),
      };
}
export function assistanceState(
  state: 'not_requested' | 'pending' | 'available' | 'unavailable' | 'expired',
) {
  return {
    not_requested: 'Assistance has not been requested. Your recorded report is available below.',
    pending: 'Assistance is pending. Continue with your recorded report while it is prepared.',
    available: 'A separate assistance attachment is available. It does not change recorded facts.',
    unavailable: 'Assistance is unavailable. Use your recorded report and reviewed guidance.',
    expired:
      'Assistance has expired. Use your recorded report or explicitly request a current explanation.',
  }[state];
}
