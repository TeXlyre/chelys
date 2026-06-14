export const t = (s: string, vars?: Record<string, unknown>) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
