// Shared look of text-like controls (Input, Textarea, Select, DatePicker, SearchBar).
export type ControlState = 'default' | 'error' | 'success'
export type ControlSize = 'sm' | 'md' | 'lg'

export function controlClasses(state: ControlState = 'default', size: ControlSize = 'md', extra = ''): string {
  return [
    'w-full rounded border bg-surface text-ink placeholder:text-ink-subtle transition-colors duration-fast ease-om',
    'focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-subtle read-only:bg-surface-2',
    { sm: 'h-8 px-2.5 text-sm', md: 'h-10 px-3 text-md', lg: 'h-12 px-4 text-lg' }[size],
    {
      default: 'border-line-strong hover:border-ink-subtle focus:border-primary focus:ring-primary/20',
      error: 'border-danger focus:border-danger focus:ring-danger/20',
      success: 'border-success focus:border-success focus:ring-success/20'
    }[state],
    extra
  ].join(' ')
}
