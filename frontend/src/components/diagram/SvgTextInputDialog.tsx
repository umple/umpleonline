/**
 * Small prompt the state-diagram adapter opens when an edit needs a typed name.
 * SmartSvgView renders it. The adapter waits for the value before rewriting Umple.
 */

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { SvgTextInputRequest } from './svg-adapters/types'

interface SvgTextInputDialogProps {
  request: SvgTextInputRequest | null
  onCancel: () => void
  onSubmit: (value: string) => void
}

export function SvgTextInputDialog({
  request,
  onCancel,
  onSubmit,
}: SvgTextInputDialogProps) {
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(request?.defaultValue ?? '')
  }, [request])

  const open = request !== null
  const submitDisabled = request?.inputType === 'color'
    ? value.trim().length === 0
    : value.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{request?.title ?? 'Edit Value'}</DialogTitle>
          {request?.description ? (
            <DialogDescription>{request.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="svg-text-input">{request?.label ?? 'Value'}</FieldLabel>
            <FieldContent>
              <Input
                id="svg-text-input"
                type={request?.inputType ?? 'text'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={request?.placeholder}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !submitDisabled) {
                    event.preventDefault()
                    onSubmit(value)
                  }
                }}
                data-testid="svg-text-input-dialog-input"
              />
            </FieldContent>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(value)}
            disabled={submitDisabled}
            data-testid="svg-text-input-dialog-submit"
          >
            {request?.submitLabel ?? 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
