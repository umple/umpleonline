/**
 * One row inside a diagram context menu.
 * The class, edge, and canvas menus share this so items look the same.
 */

interface MenuItemProps {
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
  variant?: 'destructive'
}

export function MenuItem({ onClick, icon, children, variant }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`relative flex w-full cursor-default items-center gap-1.5 rounded-sm px-2 py-1 text-xs outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
        variant === 'destructive'
          ? 'text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
          : ''
      }`}
    >
      <span className={variant === 'destructive' ? '' : 'text-muted-foreground'}>{icon}</span>
      {children}
    </button>
  )
}
