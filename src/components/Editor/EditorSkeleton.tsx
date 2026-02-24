export function EditorSkeleton() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading editor...</span>
      </div>
    </div>
  )
}
