// What Chromium draws with when it can't use the GPU.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/**
 * The renderer's name when the page is drawn without a GPU, otherwise null.
 * Chromium turns WebGL off entirely when it falls back to software, so a
 * missing context counts too.
 */
export function softwareRenderer(): string | null {
	const gl = document.createElement('canvas').getContext('webgl');
	if (!gl) return 'WebGL unavailable';
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const name: string = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return SOFTWARE.test(name) ? name : null;
}
