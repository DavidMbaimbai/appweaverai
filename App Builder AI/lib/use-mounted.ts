'use client';

import { useLayoutEffect, useState } from 'react';

export function useMounted() {
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setTimeout(() => {
      setMounted(true);
    }, 0);
  }, []);

  return mounted;
}
