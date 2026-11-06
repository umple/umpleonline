/**
 * Click actions for a state diagram: rename, recolor, and edit transitions.
 * Each action calls stateTransforms.ts to rewrite the Umple, then the editor takes the new text.
 */

import {
  addSubstateInCode,
  addTransitionInCode,
  deleteStateInCode,
  deleteTransitionInCode,
  parseStateEdgeTarget,
  parseStateNodeTarget,
  renameStateInCode,
  setStateColorInCode,
  setTransitionActionInCode,
  setTransitionDestinationInCode,
  setTransitionGuardInCode,
  setTransitionTriggerInCode,
  type SvgStateTarget,
} from './stateTransforms'
import type {
  SvgAdapterContext,
  SvgDiagramAdapter,
  SvgInteractionTarget,
  SvgMenuAction,
  SvgTextInputRequest,
} from './types'

function applyCodeUpdate(ctx: SvgAdapterContext, next: string | null, fallbackMessage: string) {
  if (!next || next === ctx.getCode()) {
    ctx.report(fallbackMessage)
    return
  }
  ctx.replaceCode(next)
}

async function promptValue(ctx: SvgAdapterContext, request: SvgTextInputRequest): Promise<string | null> {
  const value = await ctx.requestTextInput(request)
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function asStateTarget(target: SvgInteractionTarget): SvgStateTarget {
  return {
    rawId: target.rawId,
    anchorTitle: target.anchorTitle,
  }
}

function buildNodeActions(target: SvgInteractionTarget, ctx: SvgAdapterContext): SvgMenuAction[] {
  const stateTarget = asStateTarget(target)
  const parsed = parseStateNodeTarget(stateTarget)

  return [
    {
      id: 'rename-state',
      label: 'Rename State',
      async run() {
        const nextName = await promptValue(ctx, {
          title: 'Rename State',
          description: `Update the name for ${parsed.stateName}.`,
          label: 'State name',
          defaultValue: parsed.stateName,
          submitLabel: 'Rename',
        })
        if (!nextName) return
        applyCodeUpdate(ctx, renameStateInCode(ctx.getCode(), stateTarget, nextName), 'Unable to rename this state.')
      },
    },
    {
      id: 'delete-state',
      label: 'Delete State',
      variant: 'destructive',
      run() {
        applyCodeUpdate(ctx, deleteStateInCode(ctx.getCode(), stateTarget), 'Unable to delete this state.')
      },
    },
    {
      id: 'add-substate',
      label: 'Add Substate',
      async run() {
        const nextName = await promptValue(ctx, {
          title: 'Add Substate',
          description: `Create a new substate inside ${parsed.stateName}.`,
          label: 'Substate name',
          placeholder: 'NewState',
          submitLabel: 'Add',
        })
        if (!nextName) return
        applyCodeUpdate(ctx, addSubstateInCode(ctx.getCode(), stateTarget, nextName), 'Unable to add a substate here.')
      },
    },
    {
      id: 'add-transition',
      label: 'Add Transition',
      async run() {
        const trigger = await promptValue(ctx, {
          title: 'Add Transition',
          description: `Create a transition from ${parsed.stateName}.`,
          label: 'Trigger',
          placeholder: 'eventName',
          submitLabel: 'Next',
        })
        if (!trigger) return
        const destination = await promptValue(ctx, {
          title: 'Add Transition',
          description: `Choose the destination for ${trigger}.`,
          label: 'Destination state',
          placeholder: 'TargetState',
          submitLabel: 'Add',
        })
        if (!destination) return
        applyCodeUpdate(
          ctx,
          addTransitionInCode(ctx.getCode(), stateTarget, trigger, {
            rawId: destination,
            anchorTitle: `Class Unknown, SM state, State ${destination}`,
          }),
          'Unable to add this transition.',
        )
      },
    },
    {
      id: 'change-color',
      label: 'Change Color',
      async run() {
        const color = await promptValue(ctx, {
          title: 'Change State Color',
          description: `Set the display color for ${parsed.stateName}.`,
          label: 'Color',
          defaultValue: '#ff0000',
          submitLabel: 'Apply',
          inputType: 'color',
        })
        if (!color) return
        applyCodeUpdate(ctx, setStateColorInCode(ctx.getCode(), stateTarget, color), 'Unable to change this state color.')
      },
    },
  ]
}

function buildEdgeActions(target: SvgInteractionTarget, ctx: SvgAdapterContext): SvgMenuAction[] {
  const edgeTarget = asStateTarget(target)
  const parsed = parseStateEdgeTarget(edgeTarget)

  return [
    {
      id: 'change-event',
      label: 'Change Event',
      async run() {
        const trigger = await promptValue(ctx, {
          title: 'Change Event',
          description: `Update the event for ${parsed.sourceLabel} -> ${parsed.targetLabel}.`,
          label: 'Trigger',
          defaultValue: parsed.trigger,
          submitLabel: 'Save',
        })
        if (!trigger) return
        applyCodeUpdate(ctx, setTransitionTriggerInCode(ctx.getCode(), edgeTarget, trigger), 'Unable to update this transition.')
      },
    },
    {
      id: 'change-guard',
      label: 'Change Guard',
      async run() {
        const guard = await promptValue(ctx, {
          title: 'Change Guard',
          description: `Update the guard for ${parsed.sourceLabel} -> ${parsed.targetLabel}.`,
          label: 'Guard',
          defaultValue: parsed.guard ?? '[condition]',
          submitLabel: 'Save',
        })
        if (!guard) return
        applyCodeUpdate(ctx, setTransitionGuardInCode(ctx.getCode(), edgeTarget, guard), 'Unable to update this guard.')
      },
    },
    {
      id: 'change-action',
      label: 'Change Action',
      async run() {
        const action = await promptValue(ctx, {
          title: 'Change Action',
          description: `Update the action for ${parsed.sourceLabel} -> ${parsed.targetLabel}.`,
          label: 'Action',
          defaultValue: parsed.action ?? '{ action(); }',
          submitLabel: 'Save',
        })
        if (!action) return
        applyCodeUpdate(ctx, setTransitionActionInCode(ctx.getCode(), edgeTarget, action), 'Unable to update this action.')
      },
    },
    {
      id: 'change-destination',
      label: 'Change Destination',
      async run() {
        const destination = await promptValue(ctx, {
          title: 'Change Destination',
          description: `Update the destination for ${parsed.sourceLabel} -> ${parsed.targetLabel}.`,
          label: 'Destination state',
          defaultValue: parsed.targetLabel,
          submitLabel: 'Save',
        })
        if (!destination) return
        applyCodeUpdate(
          ctx,
          setTransitionDestinationInCode(ctx.getCode(), edgeTarget, {
            rawId: parsed.targetRawId,
            anchorTitle: `Class Unknown, SM state, State ${destination}`,
          }),
          'Unable to update this destination.',
        )
      },
    },
    {
      id: 'delete-transition',
      label: 'Delete Transition',
      variant: 'destructive',
      run() {
        applyCodeUpdate(ctx, deleteTransitionInCode(ctx.getCode(), edgeTarget), 'Unable to delete this transition.')
      },
    },
  ]
}

export const stateSvgAdapter: SvgDiagramAdapter = {
  viewMode: 'state',
  getContextMenuActions(target, ctx) {
    return target.kind === 'edge'
      ? buildEdgeActions(target, ctx)
      : buildNodeActions(target, ctx)
  },
}
