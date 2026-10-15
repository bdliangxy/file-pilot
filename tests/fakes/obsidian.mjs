let language = 'en';

export function getLanguage() {
	return language;
}

export function setLanguage(value) {
	language = value;
}

export class Notice {
	constructor(message) {
		this.message = message;
	}
}
