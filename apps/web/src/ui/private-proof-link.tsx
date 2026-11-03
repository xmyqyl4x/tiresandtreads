import { useRef, useState } from 'react';
import { Button } from './controls.tsx';
export function PrivateProofLink({ link }: { link: string }) {
  const input = useRef<HTMLInputElement>(null),
    [message, setMessage] = useState('');
  return (
    <div className="private-link">
      <p>Keep this link private. It grants access to this request’s status.</p>
      <label>
        Private request status link
        <input ref={input} readOnly value={link} onFocus={(e) => e.target.select()} />
      </label>
      <div className="actions">
        <Button
          tone="secondary"
          onClick={() => {
            void (async () => {
              try {
                if (!navigator.clipboard) throw Error('Copy unavailable');
                await navigator.clipboard.writeText(link);
                setMessage('Private link copied.');
              } catch {
                input.current?.focus();
                input.current?.select();
                setMessage(
                  'Copy was unavailable. The private link is selected for manual copying.',
                );
              }
            })();
          }}
        >
          Copy private status link
        </Button>
        <a href={link}>Open private request status</a>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
