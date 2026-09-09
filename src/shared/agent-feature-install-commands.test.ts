import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallArgs,
  buildAgentFeatureSkillInstallCommand,
  ALICORN_CLI_SKILL_INSTALL_COMMAND,
  buildAgentFeatureSkillUpdateArgs,
  buildAgentFeatureSkillUpdateCommand,
  COMPUTER_USE_SKILL_UPDATE_COMMAND,
  EPHEMERAL_VMS_SKILL_UPDATE_COMMAND,
  LINEAR_TICKETS_SKILL_UPDATE_COMMAND,
  ALICORN_LINEAR_SKILL_UPDATE_COMMAND,
  ALICORN_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND,
  ALICORN_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from './agent-feature-install-commands'

describe('agent feature skill commands', () => {
  it('builds a global install command by default', () => {
    expect(buildAgentFeatureSkillInstallCommand(['alicorn-cli'])).toBe(
      'npx skills add https://github.com/stablyai/orca --skill alicorn-cli --global'
    )
  })

  it('drops --global when installing locally', () => {
    expect(buildAgentFeatureSkillInstallCommand(['alicorn-cli'], { global: false })).toBe(
      'npx skills add https://github.com/stablyai/orca --skill alicorn-cli'
    )
  })

  it('repeats --skill per name for multi-skill installs', () => {
    expect(buildAgentFeatureSkillInstallCommand(['alicorn-cli', 'orchestration'])).toBe(
      'npx skills add https://github.com/stablyai/orca --skill alicorn-cli --skill orchestration --global'
    )
    expect(buildAgentFeatureSkillInstallArgs(['alicorn-cli', 'orchestration'])).toEqual([
      'skills',
      'add',
      'https://github.com/stablyai/orca',
      '--skill',
      'alicorn-cli',
      '--skill',
      'orchestration',
      '--global'
    ])
  })

  it('keeps the copyable Settings commands interactive by default', () => {
    // Why: -y skips the agent picker. A human pasting from Settings should still
    // get it; only an unattended spawn opts in.
    expect(buildAgentFeatureSkillInstallCommand(['alicorn-cli'])).not.toContain('-y')
    expect(buildAgentFeatureSkillUpdateCommand('alicorn-cli')).not.toContain('-y')
    expect(ALICORN_CLI_SKILL_INSTALL_COMMAND).not.toContain('-y')
    expect(ALICORN_CLI_SKILL_UPDATE_COMMAND).not.toContain('-y')
  })

  it('refuses to skip prompts without an install target', () => {
    // Why: -y with no --agent is the one combination that makes `skills add`
    // install into every agent it knows (~75). No caller may express it.
    expect(() => buildAgentFeatureSkillInstallCommand(['alicorn-cli'], { yes: true })).toThrow(
      'An install target is required when skipping prompts.'
    )
  })

  it('refuses a target the skills CLI would drop', () => {
    // Why: defence in depth behind the CLI's own check — the skills CLI silently
    // drops a `-`-leading --agent value, which empties its target list and
    // installs into every agent it knows.
    expect(() =>
      buildAgentFeatureSkillInstallCommand(['alicorn-cli'], { yes: true, agents: ['-y'] })
    ).toThrow('"-y" is not a usable install target.')
    expect(() =>
      buildAgentFeatureSkillInstallArgs(['alicorn-cli'], {
        yes: true,
        agents: ['universal', 'a b']
      })
    ).toThrow('"a b" is not a usable install target.')
  })

  it('appends -y and the targets for an unattended run', () => {
    expect(
      buildAgentFeatureSkillInstallCommand(['alicorn-cli'], { yes: true, agents: ['universal'] })
    ).toBe(
      'npx skills add https://github.com/stablyai/orca --skill alicorn-cli --global --agent universal -y'
    )
    expect(buildAgentFeatureSkillUpdateCommand(['alicorn-cli'], { global: false, yes: true })).toBe(
      'npx skills update alicorn-cli --project -y'
    )
    expect(
      buildAgentFeatureSkillInstallArgs(['alicorn-cli'], { yes: true, agents: ['universal'] }).at(
        -1
      )
    ).toBe('-y')
    expect(buildAgentFeatureSkillUpdateArgs(['alicorn-cli'], { yes: true }).at(-1)).toBe('-y')
  })

  it('builds single-skill update commands', () => {
    expect(buildAgentFeatureSkillUpdateCommand('orchestration')).toBe(
      'npx skills update orchestration --global'
    )
  })

  it('trims and rejects blank update skill names', () => {
    expect(buildAgentFeatureSkillUpdateCommand('  alicorn-cli  ')).toBe(
      'npx skills update alicorn-cli --global'
    )
    expect(() => buildAgentFeatureSkillUpdateCommand('   ')).toThrow('A skill name is required.')
  })

  it('builds multi-skill update commands and selects project scope for --local', () => {
    expect(buildAgentFeatureSkillUpdateCommand(['alicorn-cli', 'orchestration'])).toBe(
      'npx skills update alicorn-cli orchestration --global'
    )
    expect(buildAgentFeatureSkillUpdateCommand(['alicorn-cli'], { global: false })).toBe(
      'npx skills update alicorn-cli --project'
    )
    expect(buildAgentFeatureSkillUpdateArgs(['alicorn-cli'], { global: false })).toEqual([
      'skills',
      'update',
      'alicorn-cli',
      '--project'
    ])
    expect(() => buildAgentFeatureSkillUpdateCommand([])).toThrow('A skill name is required.')
  })

  it('exports single-skill update constants without changing install bundles', () => {
    expect(ALICORN_CLI_SKILL_UPDATE_COMMAND).toBe('npx skills update alicorn-cli --global')
    expect(COMPUTER_USE_SKILL_UPDATE_COMMAND).toBe('npx skills update computer-use --global')
    expect(ORCHESTRATION_SKILL_UPDATE_COMMAND).toBe('npx skills update orchestration --global')
    expect(EPHEMERAL_VMS_SKILL_UPDATE_COMMAND).toBe(
      'npx skills update alicorn-per-workspace-env --global'
    )
    expect(ALICORN_LINEAR_SKILL_UPDATE_COMMAND).toBe('npx skills update alicorn-linear --global')
    expect(LINEAR_TICKETS_SKILL_UPDATE_COMMAND).toBe('npx skills update linear-tickets --global')
    expect(ALICORN_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND).toBe(
      buildAgentFeatureSkillInstallCommand(['alicorn-cli', 'orchestration'])
    )
  })
})
