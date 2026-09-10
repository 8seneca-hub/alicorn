/**
 * Adding an MCP server to a project without hand-editing JSON.
 *
 * Deliberately generic rather than a menu of named integrations: a preset that asserted the wrong
 * launch command for someone's server would be worse than an empty field, and every MCP server
 * is the same four things — a name, a command, its arguments, and the environment variable *names*
 * it needs. The values are never collected here; the launching process resolves them.
 */
import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'
import {
  isValidMcpServerName,
  parseMcpServerArgs,
  parseMcpServerEnvNames,
  type McpServerDraft
} from '../../../../shared/mcp-config-write'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown so it is obvious which file is about to change. */
  relativePath: string
  saving: boolean
  onSubmit: (draft: McpServerDraft) => void
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function McpAddServerDialog({
  open,
  onOpenChange,
  relativePath,
  saving,
  onSubmit
}: Props): React.JSX.Element {
  const [name, setName] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [env, setEnv] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setName('')
      setCommand('')
      setArgs('')
      setEnv('')
    }
  }, [open])

  const nameValid = isValidMcpServerName(name)
  const canSubmit = nameValid && command.trim() !== '' && !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.mcpAddServer.title', 'Add MCP server')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.mcpAddServer.description',
              'Merged into {{path}}. Servers already in the file are kept.',
              { path: relativePath }
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field
            label={translate('auto.components.settings.mcpAddServer.name', 'Name')}
            hint={
              name !== '' && !nameValid
                ? translate(
                    'auto.components.settings.mcpAddServer.nameInvalid',
                    'Letters, digits, dash and underscore only.'
                  )
                : translate(
                    'auto.components.settings.mcpAddServer.nameHint',
                    'How the agent refers to the server, for example plane.'
                  )
            }
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="plane"
              aria-label={translate('auto.components.settings.mcpAddServer.name', 'Name')}
              className="h-8 text-xs"
            />
          </Field>

          <Field
            label={translate('auto.components.settings.mcpAddServer.command', 'Command')}
            hint={translate(
              'auto.components.settings.mcpAddServer.commandHint',
              'Whatever launches the server, for example npx.'
            )}
          >
            <Input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx"
              aria-label={translate('auto.components.settings.mcpAddServer.command', 'Command')}
              className="h-8 font-mono text-xs"
            />
          </Field>

          <Field
            label={translate('auto.components.settings.mcpAddServer.args', 'Arguments')}
            hint={translate(
              'auto.components.settings.mcpAddServer.argsHint',
              'Separated by spaces.'
            )}
          >
            <Input
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="-y my-mcp-server"
              aria-label={translate('auto.components.settings.mcpAddServer.args', 'Arguments')}
              className="h-8 font-mono text-xs"
            />
          </Field>

          <Field
            label={translate(
              'auto.components.settings.mcpAddServer.env',
              'Environment variable names'
            )}
            hint={translate(
              'auto.components.settings.mcpAddServer.envHint',
              'Names only — the value is read from the environment at launch and is never written to this file.'
            )}
          >
            <Input
              value={env}
              onChange={(event) => setEnv(event.target.value)}
              placeholder="PLANE_API_KEY, PLANE_BASE_URL"
              aria-label={translate(
                'auto.components.settings.mcpAddServer.env',
                'Environment variable names'
              )}
              className="h-8 font-mono text-xs"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.mcpAddServer.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                command: command.trim(),
                args: parseMcpServerArgs(args),
                env: parseMcpServerEnvNames(env)
              })
            }
          >
            {translate('auto.components.settings.mcpAddServer.add', 'Add server')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
