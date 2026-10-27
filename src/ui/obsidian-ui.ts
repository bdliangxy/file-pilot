
const HIDE_CLASS = 'file-pilot-hide-shadow-notes';

export function setShadowNotesHidden(hidden: boolean): void {
	document.body.classList.toggle(HIDE_CLASS, hidden);
}
