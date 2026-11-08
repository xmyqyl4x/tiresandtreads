import { hydrateRoot } from 'react-dom/client';
import { PartnerPortal } from './portal.tsx';
import '../portal.css';
const root = document.getElementById('p2-partner-root');
if (root) hydrateRoot(root, <PartnerPortal />);
