import { readAlicornEnv } from './alicorn-env-compat'

export const AGENT_HOOK_ENDPOINT_FILE_NAMES = ['endpoint.env', 'endpoint.cmd'] as const

export type AgentHookEndpointFileName = (typeof AGENT_HOOK_ENDPOINT_FILE_NAMES)[number]

export type AgentHookEndpoint = {
  port: string
  token: string
  env: string
  version: string
}

export function isAgentHookEndpointFileName(name: string): name is AgentHookEndpointFileName {
  return AGENT_HOOK_ENDPOINT_FILE_NAMES.some((fileName) => fileName === name)
}

export function parseAgentHookEndpointFile(contents: string): AgentHookEndpoint {
  const values: NodeJS.ProcessEnv = Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const normalizedLine = line.replace(/^set\s+/i, '')
        const [key, ...rest] = normalizedLine.split('=')
        return [key, rest.join('=')]
      })
  )
  // Why both spellings: this file outlives the upgrade that renamed the env, and a PTY from
  // the previous release keeps sourcing the one it was given.
  const port = readAlicornEnv(values, 'ALICORN_AGENT_HOOK_PORT')
  const token = readAlicornEnv(values, 'ALICORN_AGENT_HOOK_TOKEN')
  const env = readAlicornEnv(values, 'ALICORN_AGENT_HOOK_ENV')
  const version = readAlicornEnv(values, 'ALICORN_AGENT_HOOK_VERSION')
  if (!port || !token || !env || !version) {
    throw new Error('Agent hook endpoint file is missing required fields')
  }
  return { port, token, env, version }
}
