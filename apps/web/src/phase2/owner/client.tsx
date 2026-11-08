import { hydrateRoot } from 'react-dom/client';
import { OwnerWorkspace } from './workspace.tsx';
import '../portal.css';
const root = document.getElementById('p2-owner-root');
if (root) hydrateRoot(root, <OwnerWorkspace />);
