export type LeftTitlebarChromeLayoutInput = {
  workspaceChromeActive: boolean
  creationLayoutActive: boolean
}

export type LeftTitlebarChromeLayout = {
  shouldMount: boolean
  isFloating: boolean
}

/**
 * Where the window's left controls live.
 *
 * Always floating now that Alicorn has removed Alicorn's workspace sidebar: the controls used to sit
 * in a header the width of that column, and with nothing under it there is no column to be the
 * width of. The rail is the leftmost thing on screen and pads for the traffic lights itself.
 */
export function resolveLeftTitlebarChromeLayout({
  workspaceChromeActive,
  creationLayoutActive
}: LeftTitlebarChromeLayoutInput): LeftTitlebarChromeLayout {
  const shouldMount = workspaceChromeActive || creationLayoutActive
  return { shouldMount, isFloating: shouldMount }
}
