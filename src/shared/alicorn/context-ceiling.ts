// Quality degrades around 300–400k tokens, so the ceiling is enforced well
// before the window is full — never at 100%.
export const ALICORN_CONTEXT_CEILING_TOKENS = 300_000
