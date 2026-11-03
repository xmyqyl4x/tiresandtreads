import type { AnchorHTMLAttributes } from 'react';
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
