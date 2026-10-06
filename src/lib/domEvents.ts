// Names of the CustomEvents that RemoteBridge and the UI components use to talk
// to each other. Both the dispatching and the listening side import from here,
// so a rename or typo is a type error instead of a silently dead remote.

export const DOM_EVENTS = {
	playerAction: 'pivi-player-action',
	playerSeek: 'pivi-player-seek',
	playerQuality: 'pivi-player-quality',
	playerSubtitle: 'pivi-player-subtitle',
	playerVolume: 'pivi-player-volume',
	playerStateChanged: 'pivi-player-state-changed',
	suggestion: 'pivi-suggestion',
	sliderAdjust: 'pivi-slider-adjust',
	remotePress: 'pivi-remote-press',
	textExit: 'pivi-text-exit'
} as const;
