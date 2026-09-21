import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { usernameError } from '#lib/username';
import { db } from './db';
import { user } from './db/schema';

const scrypt = promisify(scryptCallback);

const PIN_PATTERN = /^\d{4}$/;
const KEY_LENGTH = 64;

export class InvalidPinError extends Error {
	constructor() {
		super('PIN must be exactly 4 digits');
	}
}

export class InvalidUsernameError extends Error {
	constructor(message: string) {
		super(message);
	}
}

export class UsernameTakenError extends Error {
	constructor() {
		super('Username is already taken');
	}
}

export class InvalidCredentialsError extends Error {
	constructor() {
		super('Invalid username or PIN');
	}
}

function assertValidPin(pin: string) {
	if (!PIN_PATTERN.test(pin)) throw new InvalidPinError();
}

async function hashPin(pin: string) {
	const salt = randomBytes(16).toString('hex');
	const derived = (await scrypt(pin, salt, KEY_LENGTH)) as Buffer;
	return `${salt}:${derived.toString('hex')}`;
}

async function verifyPin(pin: string, hash: string) {
	const [salt, key] = hash.split(':');
	if (!salt || !key) return false;

	const keyBuffer = Buffer.from(key, 'hex');
	const derived = (await scrypt(pin, salt, keyBuffer.length)) as Buffer;
	// Buffers must be equal length for timingSafeEqual, which a corrupted
	// hash could violate, so the length is derived from the stored key.
	return timingSafeEqual(derived, keyBuffer);
}

export async function registerWithPin(username: string, pin: string) {
	assertValidPin(pin);
	const nameError = usernameError(username);
	if (nameError) throw new InvalidUsernameError(nameError);

	const existing = await db.query.user.findFirst({ where: { username } });
	if (existing) throw new UsernameTakenError();

	const pinHash = await hashPin(pin);

	const [createdUser] = await db
		.insert(user)
		.values({ username, displayUsername: username, pinHash })
		.returning();
	return createdUser;
}

export async function loginWithPin(username: string, pin: string) {
	assertValidPin(pin);

	const foundUser = await db.query.user.findFirst({ where: { username } });
	if (!foundUser?.pinHash || !(await verifyPin(pin, foundUser.pinHash))) {
		throw new InvalidCredentialsError();
	}

	return foundUser;
}
