'use client';

import { useEffect, useState } from 'react';

// True on the cloud copy. Starts false (the Mac's view) and updates once the server answers, so a failed call leaves every control visible.
export function useCloudMode(): boolean {
  const [cloud, setCloud] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/cloud-mode').then((r) => r.json() as Promise<{ cloud?: boolean }>).then((b) => { if (live) setCloud(b.cloud === true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return cloud;
}
