import { hydrateRoot } from 'react-dom/client';
import { PageView } from './ui/pages.tsx';
import '../app/globals.css';
const root = document.getElementById('preview-root'),
  page = root?.dataset.page;
if (root && page) hydrateRoot(root, <PageView page={page} />);
