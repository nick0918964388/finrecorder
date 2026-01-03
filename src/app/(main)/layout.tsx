import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SessionProvider } from '@/providers/session-provider';
import { QueryProvider } from '@/providers/query-provider';
import { Header } from '@/components/layout/header';
import { BottomNav } from '@/components/layout/bottom-nav';
import { MainContent } from '@/components/layout/main-content';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  return (
    <SessionProvider>
      <QueryProvider>
        <div className="min-h-screen bg-background">
          <Header />
          <MainContent>{children}</MainContent>
          <BottomNav />
        </div>
      </QueryProvider>
    </SessionProvider>
  );
}
