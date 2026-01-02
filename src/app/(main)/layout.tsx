import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SessionProvider } from '@/providers/session-provider';
import { QueryProvider } from '@/providers/query-provider';
import { Header } from '@/components/layout/header';
import { BottomNav } from '@/components/layout/bottom-nav';

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
          <main className="pb-20 md:pb-0">{children}</main>
          <BottomNav />
        </div>
      </QueryProvider>
    </SessionProvider>
  );
}
