export function ts(): string {
  return new Date().toISOString();
}

export function info(...a: any[]): void {
  console.log(`[${ts()}]`, ...a);
}

export function warn(...a: any[]): void {
  console.warn(`[${ts()}] WARN`, ...a);
}

export function err(...a: any[]): void {
  console.error(`[${ts()}] ERROR`, ...a);
}
