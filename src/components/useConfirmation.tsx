import { useEffect, useRef, useState } from 'react';
import Dialog from './ui/dialog';
import Button from './ui/button';

type Confirmation = { message: string; title: string; okLabel: string; cancelLabel: string; kind?: 'warning' };

export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation>();
  const resolve = useRef<((accepted: boolean) => void) | undefined>(undefined);
  useEffect(() => () => { resolve.current?.(false); }, []);
  function finish(accepted: boolean) {
    resolve.current?.(accepted);
    resolve.current = undefined;
    setRequest(undefined);
  }
  function confirm(message: string, options: Omit<Confirmation, 'message'>) {
    resolve.current?.(false);
    setRequest({ message, ...options });
    return new Promise<boolean>(done => { resolve.current = done; });
  }
  const confirmationDialog = request && <Dialog open title={request.title} description={request.message}
    closeLabel={request.cancelLabel} onOpenChange={open => { if (!open) finish(false); }}
    footer={<><Button variant="secondary" autoFocus onClick={() => finish(false)}>{request.cancelLabel}</Button>
      <Button variant="danger" onClick={() => finish(true)}>{request.okLabel}</Button></>}/>;
  return { confirm, confirmationDialog };
}
