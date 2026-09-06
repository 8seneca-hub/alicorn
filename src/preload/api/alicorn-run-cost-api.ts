import type { RunCostByDispatch } from '../../shared/alicorn/run-cost'

export type AlicornRunCostApi = {
  onChanged: (cb: (payload: RunCostByDispatch) => void) => () => void
}
