// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { PlaneStateBadge } from './WorktreeCardMetadataStatusBadges'
import type { PlaneStateGroup } from '../../../../shared/plane-types'

// The badge renders its label as visible text; the tone class sits on the
// surrounding Badge element.
function toneOf(stateName: string, group: PlaneStateGroup): string {
  cleanup()
  render(<PlaneStateBadge stateName={stateName} group={group} />)
  return screen.getByText(`State: ${stateName}`).parentElement?.className ?? ''
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('PlaneStateBadge', () => {
  it('labels the badge with the state name', () => {
    render(<PlaneStateBadge stateName="In Progress" group="started" />)
    expect(screen.getByText('State: In Progress')).toBeInTheDocument()
  })

  it('gives each group its own tone', () => {
    expect(toneOf('Done', 'completed')).toContain('purple')
    expect(toneOf('Cancelled', 'cancelled')).toContain('rose')
    expect(toneOf('In Progress', 'started')).toContain('amber')
    expect(toneOf('Backlog', 'backlog')).toContain('muted')
    expect(toneOf('Todo', 'unstarted')).toContain('muted')
  })

  it('reads the group, not the name', () => {
    // Plane state names are user-editable per project: a project can call its
    // completed state "Shipped" and its backlog "Someday". Matching on the name
    // the way Linear's badge must would mis-tone both.
    expect(toneOf('Shipped', 'completed')).toContain('purple')
    expect(toneOf('Someday', 'backlog')).toContain('muted')
    // And a state merely *named* "done" in a started group stays amber.
    expect(toneOf('Almost done', 'started')).toContain('amber')
  })
})
