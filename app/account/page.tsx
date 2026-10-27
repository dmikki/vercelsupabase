import DashboardShell from '@/app/components/dashboard-shell'
import AccountForm from './account-form'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChangeRequestPanel from '@/app/components/change-request-panel'
import ReleaseUpdater from '@/app/components/release-updater'

export default async function Account({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const { recovery } = await searchParams
  const supabase = await createClient()

  const { data: claimsData } = await supabase.auth.getClaims()
  if (!claimsData?.claims) redirect('/login')
  const {data:{user}}=await supabase.auth.getUser()
  return <>
    <DashboardShell email={user?.email || ''} name={user?.user_metadata?.full_name || ''} environment={process.env.VERCEL_ENV || 'Local'}>
      {recovery === '1' && <div className="account-banner" role="status">Password reset confirmed. Choose a new password below.</div>}
      <AccountForm claims={claimsData.claims} />
    </DashboardShell>
    <ChangeRequestPanel />
    <ReleaseUpdater initialVersion={process.env.VERCEL_GIT_COMMIT_SHA || 'local'} />
  </>
}
