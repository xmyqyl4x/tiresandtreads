import {
  checklistAnswersSchema,
  checklistStorageSchema,
} from '../../../../packages/contracts/src/education.ts';
const storageKey = 'tt-buying-checklist-v1';
const form = document.querySelector<HTMLFormElement>('#buying-checklist');
const permission = document.querySelector<HTMLInputElement>('#checklist-storage-permission');
const status = document.querySelector<HTMLElement>('#checklist-storage-status');
if (form && permission && status) {
  status.textContent =
    'Nothing is saved automatically. Choose whether to save or load on this device.';
  const message = (text: string) => {
    status.textContent = text;
  };
  form.addEventListener('click', (event) => {
    const action =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button[data-checklist]')?.dataset.checklist
        : undefined;
    if (!action) return;
    if (action === 'print') {
      window.print();
      return;
    }
    if (action !== 'clear' && !permission.checked) {
      message('Choose device-storage permission before saving or loading.');
      return;
    }
    try {
      if (action === 'clear') {
        localStorage.removeItem(storageKey);
        permission.checked = false;
        message('Saved choices deleted. Device-storage permission is off.');
        return;
      }
      if (action === 'save') {
        const data = new FormData(form);
        const answers = checklistAnswersSchema.parse(
          Array.from({ length: 14 }, (_, i) => ({
            key: i + 1,
            answer: data.get('answer-' + (i + 1)),
          })),
        );
        const record = checklistStorageSchema.parse({
          version: 1,
          revision: form.dataset.revision,
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          answers,
        });
        localStorage.setItem(storageKey, JSON.stringify(record));
        message('Choices saved on this device for up to 30 days.');
        return;
      }
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        message('No saved choices were found.');
        return;
      }
      if (raw.length > 4096) throw Error('Invalid saved choices');
      const record = checklistStorageSchema.parse(JSON.parse(raw));
      if (
        record.revision !== form.dataset.revision ||
        record.expiresAt <= new Date().toISOString()
      ) {
        localStorage.removeItem(storageKey);
        message('Saved choices expired or belong to an earlier checklist. Start a new checklist.');
        return;
      }
      for (const a of record.answers) {
        const select = form.elements.namedItem('answer-' + a.key);
        if (select instanceof HTMLSelectElement) select.value = a.answer;
      }
      message(
        'Saved choices loaded. Select Summarize my answers to calculate the current summary.',
      );
    } catch {
      message(
        'Device storage is unavailable or its saved choices are invalid. You can still use and print the checklist.',
      );
    }
  });
  permission.addEventListener('change', () => {
    if (!permission.checked) {
      try {
        localStorage.removeItem(storageKey);
        message('Permission withdrawn. Saved choices deleted.');
      } catch {
        message(
          'Permission withdrawn. Browser storage is unavailable; clear this site’s storage in browser settings if needed.',
        );
      }
    }
  });
}
