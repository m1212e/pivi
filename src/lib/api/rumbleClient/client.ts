// This file is auto-generated. Do not edit manually.
// @generated
/* eslint-disable */
// biome-ignore-all lint: This file is auto-generated
// biome-ignore-all assist: This file is auto-generated
// biome-ignore-all syntax: This file is auto-generated
import { urqlClient } from '../client';
import { Client, fetchExchange } from '@urql/core';
import { cacheExchange } from '@urql/exchange-graphcache';
import { nativeDateExchange } from '@m1212e/rumble/client';
import { schema } from './schema';
import { makeLiveQuery, makeMutation, makeSubscription, makeQuery } from '@m1212e/rumble/client';

export type Address = {
	countryCode: String | null;
	locality: String | null;
	postalCode: String | null;
	region: String | null;
	streetAddress: String | null;
};

export type AddressInput = {
	countryCode: String;
	locality?: String | null | undefined;
	postalCode?: String | null | undefined;
	region?: String | null | undefined;
	streetAddress: String;
};

export type BigInt = unknown;

export type BigIntWhereInputArgument = {
	AND?: BigIntWhereInputArgument[] | undefined;
	NOT?: BigIntWhereInputArgument | null | undefined;
	OR?: BigIntWhereInputArgument[] | undefined;
	eq?: BigInt | null | undefined;
	gt?: BigInt | null | undefined;
	gte?: BigInt | null | undefined;
	in?: BigInt[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	lt?: BigInt | null | undefined;
	lte?: BigInt | null | undefined;
	ne?: BigInt | null | undefined;
	notIn?: BigInt[] | undefined;
};

export type Boolean = boolean;

export type BooleanWhereInputArgument = {
	AND?: BooleanWhereInputArgument[] | undefined;
	NOT?: BooleanWhereInputArgument | null | undefined;
	OR?: BooleanWhereInputArgument[] | undefined;
	arrayContained?: Boolean[] | undefined;
	arrayContains?: Boolean[] | undefined;
	arrayOverlaps?: Boolean[] | undefined;
	eq?: Boolean | null | undefined;
	in?: Boolean[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	ne?: Boolean | null | undefined;
	notIn?: Boolean[] | undefined;
};

export type Bytes = unknown;

export type DateTime = Date;

export type DateTimeWhereInputArgument = {
	AND?: DateTimeWhereInputArgument[] | undefined;
	NOT?: DateTimeWhereInputArgument | null | undefined;
	OR?: DateTimeWhereInputArgument[] | undefined;
	arrayContained?: DateTime[] | undefined;
	arrayContains?: DateTime[] | undefined;
	arrayOverlaps?: DateTime[] | undefined;
	eq?: DateTime | null | undefined;
	gt?: DateTime | null | undefined;
	gte?: DateTime | null | undefined;
	in?: DateTime[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	lt?: DateTime | null | undefined;
	lte?: DateTime | null | undefined;
	ne?: DateTime | null | undefined;
	notIn?: DateTime[] | undefined;
};

export type DateWhereInputArgument = {
	AND?: DateWhereInputArgument[] | undefined;
	NOT?: DateWhereInputArgument | null | undefined;
	OR?: DateWhereInputArgument[] | undefined;
	arrayContained?: Date[] | undefined;
	arrayContains?: Date[] | undefined;
	arrayOverlaps?: Date[] | undefined;
	eq?: Date | null | undefined;
	gt?: Date | null | undefined;
	gte?: Date | null | undefined;
	ilike?: String | null | undefined;
	in?: Date[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	like?: String | null | undefined;
	lt?: Date | null | undefined;
	lte?: Date | null | undefined;
	ne?: Date | null | undefined;
	notIlike?: String | null | undefined;
	notIn?: Date[] | undefined;
	notLike?: String | null | undefined;
};

export type EmailAddress = unknown;

export type Float = number;

export type FloatWhereInputArgument = {
	AND?: FloatWhereInputArgument[] | undefined;
	NOT?: FloatWhereInputArgument | null | undefined;
	OR?: FloatWhereInputArgument[] | undefined;
	arrayContained?: Float[] | undefined;
	arrayContains?: Float[] | undefined;
	arrayOverlaps?: Float[] | undefined;
	eq?: Float | null | undefined;
	gt?: Float | null | undefined;
	gte?: Float | null | undefined;
	ilike?: String | null | undefined;
	in?: Float[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	like?: String | null | undefined;
	lt?: Float | null | undefined;
	lte?: Float | null | undefined;
	ne?: Float | null | undefined;
	notIlike?: String | null | undefined;
	notIn?: Float[] | undefined;
	notLike?: String | null | undefined;
};

export type ID = string;

export type IDWhereInputArgument = {
	AND?: IDWhereInputArgument[] | undefined;
	NOT?: IDWhereInputArgument | null | undefined;
	OR?: IDWhereInputArgument[] | undefined;
	arrayContained?: ID[] | undefined;
	arrayContains?: ID[] | undefined;
	arrayOverlaps?: ID[] | undefined;
	eq?: ID | null | undefined;
	gt?: ID | null | undefined;
	gte?: ID | null | undefined;
	ilike?: String | null | undefined;
	in?: ID[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	like?: String | null | undefined;
	lt?: ID | null | undefined;
	lte?: ID | null | undefined;
	ne?: ID | null | undefined;
	notIlike?: String | null | undefined;
	notIn?: ID[] | undefined;
	notLike?: String | null | undefined;
};

export type Int = number;

export type IntWhereInputArgument = {
	AND?: IntWhereInputArgument[] | undefined;
	NOT?: IntWhereInputArgument | null | undefined;
	OR?: IntWhereInputArgument[] | undefined;
	arrayContained?: Int[] | undefined;
	arrayContains?: Int[] | undefined;
	arrayOverlaps?: Int[] | undefined;
	eq?: Int | null | undefined;
	gt?: Int | null | undefined;
	gte?: Int | null | undefined;
	ilike?: String | null | undefined;
	in?: Int[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	like?: String | null | undefined;
	lt?: Int | null | undefined;
	lte?: Int | null | undefined;
	ne?: Int | null | undefined;
	notIlike?: String | null | undefined;
	notIn?: Int[] | undefined;
	notLike?: String | null | undefined;
};

export type JSON = any;

export type JSONWhereInputArgument = {
	AND?: JSONWhereInputArgument[] | undefined;
	NOT?: JSONWhereInputArgument | null | undefined;
	OR?: JSONWhereInputArgument[] | undefined;
	arrayContained?: JSON[] | undefined;
	arrayContains?: JSON[] | undefined;
	arrayOverlaps?: JSON[] | undefined;
	eq?: JSON | null | undefined;
	in?: JSON[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	ne?: JSON | null | undefined;
	notIn?: JSON[] | undefined;
};

export type Locale = unknown;

export type Mutation = {
	login: (p: { pin: String; username: String }) => Boolean;
	register: (p: { pin: String; username: String }) => Boolean;
	signOut: Boolean;
};

export type Pairing = {
	pairingToken: String;
	remoteUrl: String | null;
};

export type PersonName = unknown;

export type PhoneNumber = unknown;

export type Query = {
	me: () => User | null;
	pairing: () => Pairing;
	profileByUsername: (p: { username: String }) => User | null;
	profiles: () => User[];
	user: (p: { id: ID }) => User;
	users: (p?: {
		limit?: Int | null | undefined;
		offset?: Int | null | undefined;
		orderBy?: UserOrderInputArgument | null | undefined;
		where?: UserWhereInputArgument | null | undefined;
	}) => User[];
};

export type SortingParameter = 'asc' | 'desc';

export type String = string;

export type StringWhereInputArgument = {
	AND?: StringWhereInputArgument[] | undefined;
	NOT?: StringWhereInputArgument | null | undefined;
	OR?: StringWhereInputArgument[] | undefined;
	arrayContained?: String[] | undefined;
	arrayContains?: String[] | undefined;
	arrayOverlaps?: String[] | undefined;
	eq?: String | null | undefined;
	gt?: String | null | undefined;
	gte?: String | null | undefined;
	ilike?: String | null | undefined;
	in?: String[] | undefined;
	isNotNull?: Boolean | null | undefined;
	isNull?: Boolean | null | undefined;
	like?: String | null | undefined;
	lt?: String | null | undefined;
	lte?: String | null | undefined;
	ne?: String | null | undefined;
	notIlike?: String | null | undefined;
	notIn?: String[] | undefined;
	notLike?: String | null | undefined;
};

export type Subscription = {
	user: (p: { id: ID }) => User;
	users: (p?: {
		limit?: Int | null | undefined;
		offset?: Int | null | undefined;
		orderBy?: UserOrderInputArgument | null | undefined;
		where?: UserWhereInputArgument | null | undefined;
	}) => User[];
};

export type User = {
	createdAt: DateTime;
	displayUsername: String;
	id: ID;
	image: String | null;
	updatedAt: DateTime | null;
	username: String;
};

export type UserOrderInputArgument = {
	createdAt?: SortingParameter | null | undefined;
	displayUsername?: SortingParameter | null | undefined;
	id?: SortingParameter | null | undefined;
	image?: SortingParameter | null | undefined;
	updatedAt?: SortingParameter | null | undefined;
	username?: SortingParameter | null | undefined;
};

export type UserWhereInputArgument = {
	AND?: UserWhereInputArgument[] | undefined;
	NOT?: UserWhereInputArgument | null | undefined;
	OR?: UserWhereInputArgument[] | undefined;
	createdAt?: DateTimeWhereInputArgument | null | undefined;
	displayUsername?: StringWhereInputArgument | null | undefined;
	id?: IDWhereInputArgument | null | undefined;
	image?: StringWhereInputArgument | null | undefined;
	updatedAt?: DateTimeWhereInputArgument | null | undefined;
	username?: StringWhereInputArgument | null | undefined;
};

export const defaultOptions: ConstructorParameters<Client>[0] = {
	url: '/api/graphql',
	fetchSubscriptions: true,
	exchanges: [cacheExchange({ schema }), nativeDateExchange, fetchExchange],
	fetchOptions: {
		credentials: 'include'
	},
	requestPolicy: 'cache-and-network'
};

export const client = {
	/**
	 * A query and subscription combination. First queries and if exists, also subscribes to a subscription of the same name.
	 * Combines the results of both, so the result is first the query result and then live updates from the subscription.
	 * Assumes that the query and subscription return the same fields as per default when using the rumble query helpers.
	 * If no subscription with the same name exists, this will just be a query.
	 *
	 * Internally, this does some magic to make the data reactive with Svelte's reactivity system. But it can be used with other frameworks as well.
	 */
	liveQuery: makeLiveQuery<Query>({
		urqlClient,
		availableSubscriptions: new Set(['user', 'users']),
		schema
	}),
	/**
	 * A mutation that can be used to e.g. create, update or delete data.
	 */
	mutate: makeMutation<Mutation>({
		urqlClient,
		schema
	}),
	/**
	 * A continuous stream of results that updates when the server sends new data.
	 */
	subscribe: makeSubscription<Subscription>({
		urqlClient,
		schema
	}),
	/**
	 * A one-time fetch of data.
	 */
	query: makeQuery<Query>({
		urqlClient,
		schema
	})
};
