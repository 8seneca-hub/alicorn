/**
 * Whether the assistant panel is open, and what it is standing in front of.
 *
 * A module store rather than the app store: this is one panel's presentation state, read by the
 * panel and its trigger and nothing else. Putting it in global state would invite something to
 * start treating the assistant's scope as the app's scope.
 */
import type { AlicornRoute } from '../shell/alicorn-shell-route'

/** What the assistant is looking at, as the user would describe it. */
export type AssistantScope = {
  /** Null on the org library or the project list — the assistant is then org-wide. */
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskRef: string | null
}

export const EMPTY_ASSISTANT_SCOPE: AssistantScope = {
  projectId: null,
  projectName: null,
  taskId: null,
  taskRef: null
}

type AssistantState = { open: boolean; scope: AssistantScope; model: string | null }

/**
 * The model survives the panel closing, and only that.
 *
 * A session per opening is the right lifetime for a *conversation* and the wrong one for a
 * preference: nobody wants to re-pick Opus every time they summon it. `localStorage` because it is
 * one string of presentation state, and a control-plane round trip to remember a dropdown would be
 * a worse trade than losing it on a cleared profile.
 */
const MODEL_KEY = 'alicorn.assistant.model.v1'

function readStoredModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY)
  } catch {
    return null
  }
}

let state: AssistantState = {
  open: false,
  scope: EMPTY_ASSISTANT_SCOPE,
  model: readStoredModel()
}
const listeners = new Set<() => void>()

function emit(next: AssistantState): void {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function getAlicornAssistantState(): AssistantState {
  return state
}

export function subscribeAlicornAssistant(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAlicornAssistantOpen(open: boolean): void {
  if (state.open !== open) {
    emit({ ...state, open })
  }
}

export function toggleAlicornAssistant(): void {
  emit({ ...state, open: !state.open })
}

export function setAlicornAssistantModel(model: string | null): void {
  try {
    if (model) {
      window.localStorage.setItem(MODEL_KEY, model)
    } else {
      window.localStorage.removeItem(MODEL_KEY)
    }
  } catch {
    // A profile that refuses storage still gets the choice for this session.
  }
  emit({ ...state, model })
}

export function setAlicornAssistantScope(scope: AssistantScope): void {
  const current = state.scope
  if (
    current.projectId === scope.projectId &&
    current.taskId === scope.taskId &&
    current.projectName === scope.projectName &&
    current.taskRef === scope.taskRef
  ) {
    return
  }
  emit({ ...state, scope })
}

/**
 * The scope an Alicorn route is standing in.
 *
 * Derived from the route rather than declared by each screen: a screen that forgot to declare it
 * would leave the assistant quietly acting on the previous scope, which is the worst thing this
 * panel could do.
 */
export function assistantScopeForRoute(
  route: AlicornRoute,
  projectName: string | null,
  taskRef: string | null
): AssistantScope {
  if (route.scope !== 'projects' || route.projectId === null) {
    return EMPTY_ASSISTANT_SCOPE
  }
  return {
    projectId: route.projectId,
    projectName,
    taskId: route.taskId ?? null,
    taskRef
  }
}

/** What the assistant is told when the user moves, so one session follows them around. */
export function describeAssistantScope(scope: AssistantScope): string {
  if (scope.taskRef && scope.projectName) {
    return `I am now looking at task ${scope.taskRef} in project ${scope.projectName}.`
  }
  if (scope.projectName) {
    return `I am now looking at project ${scope.projectName}.`
  }
  return 'I am now looking at the org library, across every project.'
}
