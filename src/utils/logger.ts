declare const __DEV__: boolean;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;


export class Logger {
	constructor(
		private readonly devMode: boolean,
		private readonly prefix = 'File Pilot',
	) { }

	debug(message: string, ...details: unknown[]): void {
		if (!this.devMode) {
			return;
		}

		console.debug(
			`[${this.prefix}] ${message}`,
			...details,
		);
	}
}

export const logger = new Logger(isDev);
