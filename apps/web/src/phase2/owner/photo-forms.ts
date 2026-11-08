import { z, p2Revision, p2Uuid } from '../../../../../packages/contracts/src/phase2-wire.ts';
import {
  photoApiInputs,
  photoFieldInput,
} from '../../../../../packages/contracts/src/phase2-analysis.ts';
export { applyConfirmedSize, type ConfirmedSizeApplication } from '../../assessment/model.ts';
export function photoFile(file: Pick<File, 'type' | 'size'>, allowed: boolean) {
  if (!allowed) throw Error('Choose photo processing explicitly');
  z.number().int().min(1).max(10485760).parse(file.size);
  return z.enum(['image/jpeg', 'image/png', 'image/webp']).parse(file.type);
}
export function confirmationInput(f: FormData, field: unknown, current: string | null) {
  const candidate = f.get('candidate');
  return photoApiInputs.confirm.parse({
    field: photoFieldInput.parse(field),
    value: f.get('value'),
    candidateId: candidate === 'manual' ? null : p2Uuid.parse(candidate),
    revision:
      current === null
        ? '1'
        : p2Revision.parse((BigInt(p2Revision.parse(current)) + 1n).toString()),
  });
}
