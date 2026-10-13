/**
 * Inline text field for renaming a class or editing an attribute on the canvas.
 * ClassNode uses it. Committing the value sends a sync action.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface EditableFieldProps {
  /** Initial value displayed in the input */
  initialValue: string
  /** Placeholder text when empty */
  placeholder?: string
  /** Called with the new value when the user commits (Enter/blur) */
  onCommit: (value: string) => void
  /** Called when the user cancels (Escape or empty commit) */
  onCancel: () => void
  /** Optional validation: return error message or null if valid */
  validate?: (value: string) => string | null
  /** Auto-select all text on mount */
  selectAll?: boolean
}

export function EditableField({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
  validate,
  selectAll = true,
}: EditableFieldProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (selectAll) input.select()
  }, [selectAll])

  const commit = useCallback(() => {
    if (committedRef.current) return
    const trimmed = value.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    if (validate) {
      const err = validate(trimmed)
      if (err) {
        setError(err)
        return
      }
    }
    committedRef.current = true
    onCommit(trimmed)
  }, [value, onCommit, onCancel, validate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      committedRef.current = true
      onCancel()
    }
  }, [commit, onCancel])

  return (
    <div className="nodrag nowheel nopan">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null) }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Edit value'}
        aria-invalid={!!error}
        className={`w-full bg-surface-0 border rounded px-1.5 py-0.5 outline-none ${error ? 'border-status-error' : 'border-brand'} focus:ring-1 focus:ring-brand`}
        style={{ fontFamily: "inherit", fontSize: 'inherit' }}
      />
      {error && (
        <div className="text-xxs text-status-error mt-0.5 px-0.5">{error}</div>
      )}
    </div>
  )
}
