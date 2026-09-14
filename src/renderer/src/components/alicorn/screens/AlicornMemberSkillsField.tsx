/**
 * Attaching skills to a member, from what is actually installed on this machine.
 *
 * Typing a skill's name from memory is how a member ends up bound to a skill that does not exist —
 * nothing fails at save time, and the mistake surfaces as an agent that quietly never loaded it. So
 * the installed set is offered, and a name can still be typed for a skill that is not installed
 * here yet (a teammate's machine may have it, and a member is org-wide).
 *
 * `versionId: null` means "follow the catalog's latest", which is what attaching by name should
 * mean. Pinning a version is a deliberate act and does not belong in the common path.
 */
import React from 'react'
import { Check, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { MemberSkillRef } from '../../../../../shared/alicorn/members'

/** Installed skill names, or an empty list when the catalog cannot be read — never a failure. */
function useInstalledSkillNames(): string[] {
  const [names, setNames] = React.useState<string[]>([])
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.api?.skills?.listManagedInstalls?.()
        // `unsupported` is a real answer on hosts with no skills catalog, not a failure.
        const installs = result?.status === 'ok' ? result.value : []
        const found = installs.map((install) => install.name).filter((name) => name.length > 0)
        if (!cancelled) {
          setNames([...new Set(found)].sort())
        }
      } catch {
        // A machine with no skills catalog simply offers nothing to pick from.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return names
}

export function AlicornMemberSkillsField({
  skills,
  onChange
}: {
  skills: readonly MemberSkillRef[]
  onChange: (next: MemberSkillRef[]) => void
}): React.JSX.Element {
  const installed = useInstalledSkillNames()
  const [typed, setTyped] = React.useState('')
  const attached = new Set(skills.map((skill) => skill.name))

  const attach = (name: string): void => {
    const clean = name.trim()
    if (clean.length === 0 || attached.has(clean)) {
      return
    }
    onChange([...skills, { name: clean, versionId: null }])
    setTyped('')
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium">
        {translate('auto.components.alicorn.member.skills', 'Skills')}
      </span>

      {skills.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <span
              key={skill.name}
              className="flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-[11.5px]"
            >
              {skill.name}
              <button
                type="button"
                aria-label={translate('auto.components.alicorn.member.detach', 'Detach {{name}}', {
                  name: skill.name
                })}
                onClick={() => onChange(skills.filter((current) => current.name !== skill.name))}
                className="text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {installed.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {installed.map((name) => {
            const on = attached.has(name)
            return (
              <button
                key={name}
                type="button"
                onClick={() =>
                  on ? onChange(skills.filter((s) => s.name !== name)) : attach(name)
                }
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] transition',
                  on
                    ? 'border-foreground bg-accent'
                    : 'border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {on ? <Check className="size-3" /> : <Plus className="size-3" />}
                {name}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex gap-1.5">
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              attach(typed)
            }
          }}
          placeholder={translate(
            'auto.components.alicorn.member.skillPlaceholder',
            'Name a skill that is not installed here'
          )}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[12.5px]"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={typed.trim().length === 0}
          onClick={() => attach(typed)}
        >
          {translate('auto.components.alicorn.member.attach', 'Attach')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.alicorn.member.skillsDetail',
          'Attached by name, following the catalog’s latest version. A member is org-wide, so a skill not installed on this machine is still a valid thing to name.'
        )}
      </p>
    </div>
  )
}
