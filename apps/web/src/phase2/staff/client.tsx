import { hydrateRoot } from 'react-dom/client';
import { P2StaffConsole } from './console.tsx';
import '../portal.css';
const root = document.getElementById('p2-staff-root');
if (root) hydrateRoot(root, <P2StaffConsole />);
