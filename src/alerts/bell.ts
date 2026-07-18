/** Terminal bell — writes the BEL control character (0x07) to stdout. */
export function terminalBell(): void {
  try {
    process.stdout.write(String.fromCharCode(7));
  } catch {
    /* ignore */
  }
}
