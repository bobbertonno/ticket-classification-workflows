import { Toaster } from '@/components/ui/sonner'
import { ConsoleGate } from '@/components/console/console-gate'
import { DemoBar } from '@/components/console/demo-bar'
import { SessionProvider } from '@/components/console/session-provider'
import { Sidebar } from '@/components/console/sidebar'
import { Topbar } from '@/components/console/topbar'

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <DemoBar />
          <main className="flex-1 px-4 py-6 lg:px-8">
            <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
              <ConsoleGate>{children}</ConsoleGate>
            </div>
          </main>
        </div>
      </div>
      <Toaster position="bottom-right" richColors />
    </SessionProvider>
  )
}
