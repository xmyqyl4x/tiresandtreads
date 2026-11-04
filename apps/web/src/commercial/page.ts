import { commercialController } from './controller.ts';
import { densityPermits } from '../../../../packages/domain/src/commercial-presentation.ts';
export function startCommercialPage(document: Document, view: Window) {
  const found = document.querySelector<HTMLElement>('[data-commercial-inventory]');
  if (!found) return () => {};
  const root = found;
  const controller = commercialController({
    signals: () => {},
    house: () => {
      root.dataset.delivery = 'house';
    },
    hide: () => {
      root.style.visibility = 'hidden';
    },
    adapter: null,
    activationApproved: false,
    networkReady: false,
    readConsent: async () => {
      throw Error('A certified CMP binding is required before activation');
    },
  });
  let inViewport = false;
  function observe() {
    const height = root.getBoundingClientRect().height,
      main = document.querySelector('main')?.getBoundingClientRect().height ?? 0;
    const admitted = densityPermits(main - height, height);
    root.style.visibility = !admitted ? 'hidden' : '';
    void controller.refresh(inViewport && document.visibilityState === 'visible', admitted);
  }
  // Messages only invalidate. They never grant consent or trigger a tag.
  const invalidate = () => controller.invalidate();
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel('tt-privacy');
    channel.onmessage = invalidate;
  } catch {
    /* unavailable is safe */
  }
  view.addEventListener('tt-consent-changed', invalidate);
  view.addEventListener('pagehide', invalidate);
  view.addEventListener('pageshow', observe);
  view.addEventListener('resize', observe);
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inViewport = entries.some((entry) => entry.target === root && entry.isIntersecting);
          observe();
        })
      : null;
  if (observer) observer.observe(root);
  observe();
  return () => {
    observer?.disconnect();
    channel?.close();
    view.removeEventListener('tt-consent-changed', invalidate);
    view.removeEventListener('pagehide', invalidate);
    view.removeEventListener('pageshow', observe);
    view.removeEventListener('resize', observe);
    controller.close();
  };
}
