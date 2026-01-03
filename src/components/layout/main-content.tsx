'use client';

import { PullToRefresh } from '@/components/ui/pull-to-refresh';

interface MainContentProps {
  children: React.ReactNode;
}

export function MainContent({ children }: MainContentProps) {
  return (
    <PullToRefresh>
      <main className="pb-20 md:pb-0">{children}</main>
    </PullToRefresh>
  );
}
