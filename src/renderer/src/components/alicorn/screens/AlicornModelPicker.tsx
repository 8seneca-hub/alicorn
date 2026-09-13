/**
 * Which model a session runs on.
 *
 * The catalog is the authority — the same list the composer inside a session shows — so a model
 * chosen here and a model chosen mid-conversation cannot be two different vocabularies. Default is
 * a first-class entry rather than a blank: "whatever the backend picks" is a real answer, and the
 * one most tickets want.
 */
import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { getAgentSessionOptionCatalog } from '../../../../../shared/agent-session-option-catalog'
import type { AgentType } from '../../../../../shared/agent-status-types'

/** The select's value for "no explicit choice"; an empty string is not a legal SelectItem value. */
const DEFAULT_MODEL = 'default'

export function alicornModelOptions(agent: AgentType): { id: string; label: string }[] {
  const catalog = getAgentSessionOptionCatalog(agent)
  return (catalog?.models ?? []).map((model) => ({ id: model.id, label: model.label }))
}

export function AlicornModelPicker({
  agent,
  value,
  onChange,
  id,
  className
}: {
  agent: AgentType
  /** Null means the backend's own default. */
  value: string | null
  onChange: (model: string | null) => void
  id?: string
  className?: string
}): React.JSX.Element | null {
  const models = React.useMemo(() => alicornModelOptions(agent), [agent])
  if (models.length === 0) {
    // A backend Alicorn does not price or enumerate gets no picker rather than an empty one.
    return null
  }
  return (
    <Select
      value={value ?? DEFAULT_MODEL}
      onValueChange={(next) => onChange(next === DEFAULT_MODEL ? null : next)}
    >
      <SelectTrigger
        id={id}
        className={className ?? 'h-8 w-full text-xs'}
        aria-label={translate('auto.components.alicorn.model.label', 'Model')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL} className="text-xs">
          {translate('auto.components.alicorn.model.default', 'Default for this backend')}
        </SelectItem>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            {model.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
