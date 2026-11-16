'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// Whether we've moved between pages client-side since the last full page load. Lives at
// module level so it survives client-side navigations; a reload or new tab resets it.
let lastPath: string | null = null
let hasInAppHistory = false

/** Mounted once in the admin layout to notice client-side navigations. */
export function NavigationTracker() {
  const pathname = usePathname()
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) hasInAppHistory = true
    lastPath = pathname
  }, [pathname])
  return null
}

/**
 * Goes back to wherever you came from (keeping that page's filters), or to
 * `fallbackHref` when there is no earlier page in this app to return to.
 */
export default function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter()

  function goBack() {
    if (hasInAppHistory) router.back()
    else router.push(fallbackHref)
  }

  return (
    <button type="button" onClick={goBack} className="back-button" aria-label="Go back">
      <ArrowLeft size={14} />
      Back
    </button>
  )
}
