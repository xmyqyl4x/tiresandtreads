import { hydrateRoot } from 'react-dom/client';
import { AnalysisOperationsWorkspace } from './workspace.tsx';
import '../portal.css';
const root = document.getElementById('p2-operations-root');
if (root) hydrateRoot(root, <AnalysisOperationsWorkspace />);
