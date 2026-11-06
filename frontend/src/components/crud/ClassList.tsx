/**
 * Class list down the side of the object explorer.
 * Choosing a class shows its instances in InstanceTable.
 */

import { cn } from '@/lib/utils'
import { useCrudStore } from '@/stores/crudStore'
import type { CrudClass } from '@/api/types'

export function ClassList() {
  const schema = useCrudStore((s) => s.schema)
  const selectedClass = useCrudStore((s) => s.selectedClass)
  const setSelectedClass = useCrudStore((s) => s.setSelectedClass)
  const instances = useCrudStore((s) => s.instances)

  if (!schema) return null

  const concreteClasses = schema.classes.filter((c) => !c.isAbstract)
  const abstractClasses = schema.classes.filter((c) => c.isAbstract)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xxs font-semibold text-ink-muted uppercase tracking-wider">Classes</h3>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {concreteClasses.map((cls) => (
          <ClassItem
            key={cls.name}
            cls={cls}
            count={(instances[cls.name] ?? []).length}
            selected={selectedClass === cls.name}
            onClick={() => setSelectedClass(cls.name)}
          />
        ))}
        {abstractClasses.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <span className="text-xxs font-medium text-ink-faint uppercase tracking-wider">Abstract</span>
            </div>
            {abstractClasses.map((cls) => (
              <ClassItem
                key={cls.name}
                cls={cls}
                count={0}
                selected={false}
                disabled
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ClassItem({ cls, count, selected, disabled, onClick }: {
  cls: CrudClass
  count: number
  selected: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors',
        selected
          ? 'bg-brand-light text-brand font-medium'
          : disabled
            ? 'text-ink-faint italic cursor-default'
            : 'text-ink-muted hover:bg-surface-1 hover:text-ink cursor-pointer',
      )}
    >
      <span className="truncate">{cls.name}</span>
      {!disabled && (
        <span className={cn(
          'text-xxs tabular-nums ml-2 shrink-0',
          selected ? 'text-brand' : 'text-ink-faint',
        )}>
          {count}
        </span>
      )}
    </button>
  )
}
