/**
 * Teaching Claude about Alicorn in this repository, with the developer's consent.
 *
 * There is no standard flow for a product to write into someone's `CLAUDE.md`, so this is an
 * explicit act with the diff shown first: two files named, their contents previewable, one button.
 * Nothing is written until it is pressed, and pressing it again replaces only Alicorn's own block.
 *
 * Why a file at all, when the session already carries a system prompt saying much of this: the
 * prompt is ours and invisible, and a developer cannot read, edit or version it. `ALICORN.md` is
 * theirs — in the repository, in review, editable — and `CLAUDE.md`'s `@` import means it is
 * expanded at the start of every session, including sessions Alicorn did not launch.
 */
import React from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  addAlicornImport,
  ALICORN_MD_FILENAME,
  importsAlicornMd,
  renderAlicornMd,
  upsertAlicornBlock,
  type AlicornMdFacts
} from '../../../../../shared/alicorn/alicorn-md'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import { CLAUDE_MD } from './use-project-claude-md'

async function readIfPresent(filePath: string): Promise<string> {
  try {
    const read = await window.api?.fs?.readFile({ filePath })
    return read && !read.isBinary ? read.content : ''
  } catch {
    // Absent is the common case for ALICORN.md and not an error.
    return ''
  }
}

export function AlicornTeachClaudeCard({
  repoPath,
  facts,
  onWritten
}: {
  /** Null when no repository resolves here, in which case there is nowhere to write. */
  repoPath: string | null
  facts: AlicornMdFacts
  onWritten: () => void
}): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [taught, setTaught] = React.useState<boolean | null>(null)
  const block = React.useMemo(() => renderAlicornMd(facts), [facts])
  const root = repoPath ? repoPath.replace(/\/$/, '') : null

  React.useEffect(() => {
    if (!root) {
      return
    }
    let cancelled = false
    void (async () => {
      const claudeMd = await readIfPresent(`${root}/${CLAUDE_MD}`)
      const alicornMd = await readIfPresent(`${root}/${ALICORN_MD_FILENAME}`)
      if (!cancelled) {
        setTaught(alicornMd.trim().length > 0 && importsAlicornMd(claudeMd))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [root, busy])

  if (!root) {
    return null
  }

  const teach = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const alicornPath = `${root}/${ALICORN_MD_FILENAME}`
      const claudePath = `${root}/${CLAUDE_MD}`
      const existingAlicorn = await readIfPresent(alicornPath)
      await window.api.fs.writeFile({
        filePath: alicornPath,
        content: upsertAlicornBlock(existingAlicorn, block)
      })
      const existingClaude = await readIfPresent(claudePath)
      const withImport = addAlicornImport(existingClaude)
      if (withImport !== existingClaude) {
        await window.api.fs.writeFile({ filePath: claudePath, content: withImport })
      }
      onWritten()
    } catch (cause) {
      setFailure(describeFailure(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-semibold">
          {translate('auto.components.alicorn.teach.title', 'Teach Claude about Alicorn here')}
        </span>
        {taught ? (
          <span className="flex items-center gap-1 rounded-full border border-status-running/40 bg-status-running/10 px-2 py-0.5 text-[11px] text-status-running">
            <Check className="size-3" />
            {translate('auto.components.alicorn.teach.done', 'in this repository')}
          </span>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void teach()}>
          {taught
            ? translate('auto.components.alicorn.teach.update', 'Update it')
            : translate('auto.components.alicorn.teach.write', 'Write the files')}
        </Button>
      </div>
      <p className="mt-1.5 max-w-[640px] text-[12px] text-muted-foreground">
        {translate(
          'auto.components.alicorn.teach.detail',
          'Writes {{file}} and adds one import line to {{claude}}, so every session — including ones Alicorn did not start — knows what a project, a stage and a gate mean here. Your own lines are left alone; only Alicorn’s block is replaced.',
          { file: ALICORN_MD_FILENAME, claude: CLAUDE_MD }
        )}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground transition hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {expanded
          ? translate('auto.components.alicorn.teach.hide', 'Hide what it writes')
          : translate('auto.components.alicorn.teach.preview', 'See exactly what it writes')}
      </button>
      {expanded ? (
        <pre className="scrollbar-sleek mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background p-2.5 text-[11px] leading-relaxed">
          {block}
        </pre>
      ) : null}
      {failure ? <p className="mt-1.5 text-[11px] text-destructive">{failure}</p> : null}
    </section>
  )
}
