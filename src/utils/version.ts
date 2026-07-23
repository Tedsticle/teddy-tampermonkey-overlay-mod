// Injected by esbuild from the @version line of meta.userscript.js.
declare const __ARIES_MOD_VERSION__: string | undefined;

export function getLocalVersion(): string | undefined {
  // Build-time version first: GM_info reports the LOADER's version when the
  // script is loaded through a dev @require file:// userscript.
  if (typeof __ARIES_MOD_VERSION__ === "string" && __ARIES_MOD_VERSION__ !== "0.0.0") {
    return __ARIES_MOD_VERSION__;
  }
  if (typeof GM_info !== "undefined" && GM_info?.script?.version) {
    return GM_info.script.version;
  }

  return undefined;
}
