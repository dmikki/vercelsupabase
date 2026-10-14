import AccountForm from './account-form'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChangeRequestPanel from '@/app/components/change-request-panel'
import ReleaseUpdater from '@/app/components/release-updater'

export default async function Account() {
  const supabase = await createClient()

  const { data: claimsData } = await supabase.auth.getClaims()
  if (!claimsData?.claims) redirect('/login')
  return <>
    <AccountForm claims={claimsData.claims} />
    <ChangeRequestPanel />
    <ReleaseUpdater initialVersion={process.env.VERCEL_GIT_COMMIT_SHA || 'local'} />
  </>
}

