import { ipcRenderer } from 'electron'
import { ALICORN_RUN_COST_EVENT } from '../../shared/alicorn/run-cost'
import type { RunCostByDispatch } from '../../shared/alicorn/run-cost'
import type { AlicornRunCostApi } from './alicorn-run-cost-api'

// D7 owns this bridge end to end, separate from B3's alicorn-bridge.ts/alicorn-api.ts.
export const alicornRunCostApi: AlicornRunCostApi = {
  // Returns an unsubscribe rather than exposing removeListener, so a renderer
  // cannot detach another subscriber's handler.
  onChanged: (callback) => {
    const listener = (_event: unknown, payload: RunCostByDispatch): void => callback(payload)
    ipcRenderer.on(ALICORN_RUN_COST_EVENT, listener)
    return () => ipcRenderer.removeListener(ALICORN_RUN_COST_EVENT, listener)
  }
}
