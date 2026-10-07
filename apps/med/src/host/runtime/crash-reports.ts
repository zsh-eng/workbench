/** Bun uploads crash reports to bun.report on macOS unless the environment has
 * BUN_ENABLE_CRASH_REPORTING=0. Med sends nothing to any server, so it turns
 * the upload off for this process and for every process that it starts. */
export const CRASH_REPORTS_OFF = { BUN_ENABLE_CRASH_REPORTING: "0" } as const;

export async function disableCrashReports() {
  // Child processes, such as the background server and index workers, inherit this.
  Object.assign(process.env, CRASH_REPORTS_OFF);
  // Bun's crash handler reads the native environment, which process.env does
  // not change, so set it there too. Bun reports automatically only on macOS.
  if (!process.versions.bun || process.platform !== "darwin") return;
  try {
    const moduleName = "bun:ffi";
    const { dlopen, FFIType } = await import(/* @vite-ignore */ moduleName);
    const libc = dlopen("/usr/lib/libSystem.B.dylib", {
      setenv: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
    });
    for (const [name, value] of Object.entries(CRASH_REPORTS_OFF))
      libc.symbols.setenv(Buffer.from(`${name}\0`), Buffer.from(`${value}\0`), 1);
    libc.close();
  } catch {
    // Without FFI, only this process could still report; its children cannot.
  }
}
