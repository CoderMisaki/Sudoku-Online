'use client' // Error components must be Client Components

import { useEffect } from 'react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { AlertCircle, RotateCcw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <Card className="max-w-md w-full p-6 space-y-6">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold">Something went wrong!</h2>
            <p className="text-secondary text-sm">
              We encountered an error while rendering this page.
            </p>
          </div>
        </div>

        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 font-mono text-sm overflow-x-auto text-red-400">
          <p className="font-semibold mb-2">Error Details:</p>
          <pre className="whitespace-pre-wrap">{error.message || 'Unknown error occurred'}</pre>
          {error.digest && (
            <p className="mt-2 text-xs opacity-75">Digest: {error.digest}</p>
          )}
        </div>

        <div className="flex justify-center pt-2">
          <Button
            onClick={
              // Attempt to recover by trying to re-render the segment
              () => reset()
            }
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Try again
          </Button>
        </div>
      </Card>
    </div>
  )
}
