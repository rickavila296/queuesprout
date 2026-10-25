'use client';

import { Button, type ButtonProps } from '@queuesprout/ui';

/** A submit button that asks first. For removals that cannot be undone. */
export function ConfirmButton({ confirmText, ...props }: ButtonProps & { confirmText: string }) {
  return (
    <Button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    />
  );
}
