import { it, expect } from 'vitest';
import { recoverMissingPhoto } from '../../apps/web/src/phase2/owner/photo-read.ts';
it('turns only a missing selected photo into manual recovery', async () => {
  expect(
    await recoverMissingPhoto(async () => {
      throw { code: 'not_found' };
    }),
  ).toEqual({ missing: true });
  expect(await recoverMissingPhoto(async () => 7)).toEqual({ missing: false, value: 7 });
});
it.each(['unauthorized', 'forbidden', 'unavailable', 'conflict'])(
  'preserves %s for the private workbench',
  async (code) => {
    await expect(
      recoverMissingPhoto(async () => {
        throw { code };
      }),
    ).rejects.toEqual({ code });
  },
);
