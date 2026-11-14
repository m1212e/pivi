// The thumbnail of the video that was just tapped. The player shows it softened
// behind the spinner while the stream resolves and buffers, instead of a black
// screen: first as the stand-in the card grows into (+layout.svelte), then
// behind the <video> until its first frame (play/[appId]/[sessionId]).
export const launchBackdrop = $state<{ url: string | null }>({ url: null });
