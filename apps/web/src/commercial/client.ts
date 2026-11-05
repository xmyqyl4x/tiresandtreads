import { startCommercialPage } from './page.ts';
const stop = startCommercialPage(document, window);
window.addEventListener('pagehide', stop, { once: true });
