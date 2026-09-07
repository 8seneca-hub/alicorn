import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { MessageRow } from './types'

// Who may settle a dispatch. Split out of lifecycle-reconciliation.ts to keep that file under the
// line cap; the rules themselves are unchanged.
type DispatchAssignee = { assignee_handle: string | null; assignee_pane_key: string | null }

// Why: the tab half can change on pane break-out, while opaque legacy keys
// have no safe equivalence beyond exact equality.
function isSamePane(assigneePaneKey: string, senderPaneKey: string): boolean {
  if (assigneePaneKey === senderPaneKey) {
    return true
  }
  const assigneeLeaf = parsePaneKey(assigneePaneKey)?.leafId
  const senderLeaf = parsePaneKey(senderPaneKey)?.leafId
  return Boolean(assigneeLeaf && senderLeaf && assigneeLeaf === senderLeaf)
}

export function hasLifecycleAuthority(dispatch: DispatchAssignee, msg: MessageRow): boolean {
  if (dispatch.assignee_pane_key) {
    return Boolean(
      msg.sender_pane_key && isSamePane(dispatch.assignee_pane_key, msg.sender_pane_key)
    )
  }
  // Why: rows created before pane identity existed can only use the exact
  // handle recorded at dispatch; payload knowledge alone is not authority.
  return dispatch.assignee_handle === msg.from_handle
}

export function buildLifecycleAuthorityRejectionReason(
  dispatchId: string,
  dispatch: DispatchAssignee,
  msg: MessageRow
): string {
  return (
    `dispatch ${dispatchId} expected handle ${dispatch.assignee_handle ?? '<unknown>'}, ` +
    `pane ${dispatch.assignee_pane_key ?? '<legacy>'}; received handle ${msg.from_handle}, ` +
    `pane ${msg.sender_pane_key ?? '<missing>'}`
  )
}
