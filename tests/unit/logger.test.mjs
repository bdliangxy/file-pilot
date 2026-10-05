import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { Logger } = await jiti.import('../../src/utils/logger.ts');

test('outputs debug logs in development mode', () => {
	const messages = [];
	const originalDebug = console.debug;

	console.debug = (...args) => {
		messages.push(args);
	};

	try {
		const logger = new Logger(true);

		logger.debug('test message', 123);

		assert.deepEqual(
			messages,
			[['[File Pilot] test message', 123]],
		);
	} finally {
		console.debug = originalDebug;
	}
});

test('does not output debug logs in production mode', () => {
	const messages = [];
	const originalDebug = console.debug;

	console.debug = (...args) => {
		messages.push(args);
	};

	try {
		const logger = new Logger(false);

		logger.debug('test message', 123);

		assert.equal(messages.length, 0);
	} finally {
		console.debug = originalDebug;
	}
});
