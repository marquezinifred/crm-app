'use client';

import * as React from 'react';

/**
 * Tooltip mínimo Venzo — sem deps externas. Aparece após 300ms hover /
 * imediatamente em focus. `role="tooltip"` + aria-describedby no trigger.
 *
 * Para popovers ricos, use <Popover> em popover.tsx.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
}) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 300);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 100);
  }

  const trigger = React.cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-50 max-w-[240px] rounded bg-text-1 text-card px-2 py-1 text-caption shadow-lg pointer-events-none whitespace-normal ${
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } left-1/2 -translate-x-1/2`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
