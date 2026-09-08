import type { MemberDirectory } from '../alicorn/member-directory'
import type { RunBlastRadiusSource } from '../alicorn/gates/run-blast-radius'

export type RuntimeAlicornServiceSurface = {
  setAlicornMemberDirectory: (directory: MemberDirectory | null) => void
  /** Null when the control plane is unconfigured — `--member` is then rejected. */
  getAlicornMemberDirectory: () => MemberDirectory | null
  setAlicornBlastRadiusSource: (source: RunBlastRadiusSource | null) => void
  /** Null before startup wiring installs one — the blast radius then reads as unmeasured, so gated. */
  getAlicornBlastRadiusSource: () => RunBlastRadiusSource | null
}

// Held beside the runtime rather than on it: the directory is optional
// infrastructure, and the runtime class should not grow a field for every
// service that may or may not be configured.
const directoryByRuntime = new WeakMap<object, MemberDirectory>()
const blastRadiusByRuntime = new WeakMap<object, RunBlastRadiusSource>()

export function installRuntimeAlicornServices(target: object): void {
  const surface: RuntimeAlicornServiceSurface = {
    setAlicornMemberDirectory(this: object, directory) {
      if (directory) {
        directoryByRuntime.set(this, directory)
        return
      }
      directoryByRuntime.delete(this)
    },
    getAlicornMemberDirectory(this: object) {
      return directoryByRuntime.get(this) ?? null
    },
    setAlicornBlastRadiusSource(this: object, source) {
      if (source) {
        blastRadiusByRuntime.set(this, source)
        return
      }
      blastRadiusByRuntime.delete(this)
    },
    getAlicornBlastRadiusSource(this: object) {
      return blastRadiusByRuntime.get(this) ?? null
    }
  }
  Object.defineProperties(target, {
    setAlicornMemberDirectory: { value: surface.setAlicornMemberDirectory, writable: true },
    getAlicornMemberDirectory: { value: surface.getAlicornMemberDirectory, writable: true },
    setAlicornBlastRadiusSource: { value: surface.setAlicornBlastRadiusSource, writable: true },
    getAlicornBlastRadiusSource: { value: surface.getAlicornBlastRadiusSource, writable: true }
  })
}
