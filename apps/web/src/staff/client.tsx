import { hydrateRoot } from 'react-dom/client';
import { StaffConsole } from './console.tsx';
const root = document.getElementById('staff-root');
if (root) hydrateRoot(root, <StaffConsole />);
