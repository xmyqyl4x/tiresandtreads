import { hydrateRoot } from 'react-dom/client';
import { EditorialWorkbench } from './workbench.tsx';
const root = document.getElementById('editorial-root');
if (root) hydrateRoot(root, <EditorialWorkbench />);
