// This file is auto-generated. Do not edit manually.
// @generated
/* eslint-disable */
// biome-ignore-all lint: This file is auto-generated
// biome-ignore-all assist: This file is auto-generated
// biome-ignore-all syntax: This file is auto-generated
import type { IntrospectionQuery } from 'graphql';
export const schema = {
	__schema: {
		queryType: { name: 'Query', kind: 'OBJECT', __proto__: null },
		mutationType: { name: 'Mutation', kind: 'OBJECT', __proto__: null },
		subscriptionType: { name: 'Subscription', kind: 'OBJECT', __proto__: null },
		types: [
			{
				kind: 'OBJECT',
				name: 'Address',
				fields: [
					{
						name: 'countryCode',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'locality',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'postalCode',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'region',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'streetAddress',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'INPUT_OBJECT',
				name: 'AddressInput',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'countryCode',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						defaultValue: void 0
					},
					{
						name: 'locality',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'postalCode',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'region',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'streetAddress',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						defaultValue: void 0
					}
				]
			},
			{
				kind: 'OBJECT',
				name: 'AppCard',
				fields: [
					{
						name: 'actionJson',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'id',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'image',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'subtitle',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'title',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppDashboard',
				fields: [
					{
						name: 'appId',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'appName',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'cards',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'AppCard', kind: 'OBJECT', ofType: null, __proto__: null }
							}
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppInfo',
				fields: [
					{
						name: 'entryScreenId',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'features',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'hasUpdate',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'icon',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'id',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'name',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'primaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'secondaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppInstallPreview',
				fields: [
					{
						name: 'conflict',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'domains',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'features',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'icon',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'image',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'name',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'permissions',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'primaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'secondaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'signerFingerprint',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'version',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppManagement',
				fields: [
					{
						name: 'apps',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'ManagedApp', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'busy',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'errorMessage',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'lastCheckSummary',
						type: { kind: 'OBJECT', name: 'AppUpdateCheckSummary', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'preview',
						type: { kind: 'OBJECT', name: 'AppInstallPreview', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppNextSession',
				fields: [
					{
						name: 'sessionId',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppPlaybackInfo',
				fields: [
					{
						name: 'acodec',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'audioContainer',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'direct',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'duration',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'subtitleTracks',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: {
										name: 'AppSubtitleTrack',
										kind: 'OBJECT',
										ofType: null,
										__proto__: null
									}
								}
							}
						},
						args: []
					},
					{
						name: 'title',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'vcodec',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'videoContainer',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppScreenData',
				fields: [
					{
						name: 'json',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppSkipSegment',
				fields: [
					{
						name: 'endSeconds',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'label',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'startSeconds',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppSubtitleTrack',
				fields: [
					{
						name: 'kind',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'label',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'language',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'AppUpdateCheckSummary',
				fields: [
					{
						name: 'applied',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'checkedAt',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'failed',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'pending',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					}
				],
				interfaces: []
			},
			{ kind: 'SCALAR', name: 'BigInt' },
			{
				kind: 'INPUT_OBJECT',
				name: 'BigIntWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'BigIntWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'BigIntWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'BigIntWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'BigInt', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'BigInt', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'BigInt', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'Boolean' },
			{
				kind: 'INPUT_OBJECT',
				name: 'BooleanWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'BooleanWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'BooleanWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'BooleanWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'Bytes' },
			{ kind: 'SCALAR', name: 'Date' },
			{ kind: 'SCALAR', name: 'DateTime' },
			{
				kind: 'INPUT_OBJECT',
				name: 'DateTimeWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'DateTimeWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'DateTimeWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'DateTimeWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					}
				]
			},
			{
				kind: 'INPUT_OBJECT',
				name: 'DateWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'DateWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'DateWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'DateWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Date', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Date', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Date', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ilike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Date', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'like',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'Date', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIlike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Date', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'notLike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'EmailAddress' },
			{ kind: 'SCALAR', name: 'Float' },
			{
				kind: 'INPUT_OBJECT',
				name: 'FloatWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'FloatWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'FloatWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'FloatWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ilike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'like',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'Float', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIlike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Float', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'notLike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'ID' },
			{
				kind: 'INPUT_OBJECT',
				name: 'IDWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'IDWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'IDWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'IDWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ilike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'like',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'ID', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIlike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'notLike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'Int' },
			{
				kind: 'INPUT_OBJECT',
				name: 'IntWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'IntWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'IntWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'IntWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ilike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'like',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIlike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'notLike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'JSON' },
			{
				kind: 'INPUT_OBJECT',
				name: 'JSONWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'JSONWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'JSONWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'JSONWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'JSON', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'JSON', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'JSON', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'JSON', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'JSON', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'JSON', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'JSON', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					}
				]
			},
			{ kind: 'SCALAR', name: 'Locale' },
			{
				kind: 'OBJECT',
				name: 'ManagedApp',
				fields: [
					{
						name: 'autoUpdate',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'domains',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'enabled',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'errorMessage',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'features',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'icon',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'id',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'image',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'name',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'permissions',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: {
										name: 'ManagedAppPermission',
										kind: 'OBJECT',
										ofType: null,
										__proto__: null
									}
								}
							}
						},
						args: []
					},
					{
						name: 'primaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'secondaryColor',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'signerFingerprint',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'update',
						type: { kind: 'OBJECT', name: 'ManagedAppUpdate', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'version',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'ManagedAppPermission',
				fields: [
					{
						name: 'granted',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'key',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'ManagedAppUpdate',
				fields: [
					{
						name: 'addedDomains',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'addedPermissions',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'version',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'Mutation',
				fields: [
					{
						name: 'appUiEvent',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'eventId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'screenId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'value',
								type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null }
							}
						]
					},
					{
						name: 'approveAppUpdate',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'checkAppUpdates',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'clearAppCache',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'clearAppStorage',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'connectWifiNetwork',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'hidden',
								type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null }
							},
							{
								name: 'password',
								type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null }
							},
							{
								name: 'ssid',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'dismissAppPreview',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'installApp',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'granted',
								type: {
									kind: 'NON_NULL',
									ofType: {
										kind: 'LIST',
										ofType: {
											kind: 'NON_NULL',
											ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
										}
									}
								}
							}
						]
					},
					{
						name: 'login',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'pin',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'username',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'openUrlOnPhone',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'url',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'previewAppInstall',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'image',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'publicKey',
								type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null }
							}
						]
					},
					{
						name: 'register',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'pin',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'username',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'rejectAppUpdate',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'scanWifiNetworks',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'setAppAutoUpdate',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'autoUpdate',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'setAppEnabled',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'enabled',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'setAppPermission',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'granted',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'permission',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'signOut',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'uninstallApp',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'Network',
				fields: [
					{
						name: 'available',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'ethernet',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'hotspotPassword',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'hotspotSsid',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'mode',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'online',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'ssid',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'Pairing',
				fields: [
					{
						name: 'pairingToken',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'remoteUrl',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{ kind: 'SCALAR', name: 'PersonName' },
			{
				kind: 'OBJECT',
				name: 'PhoneConnection',
				fields: [
					{
						name: 'connected',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{ kind: 'SCALAR', name: 'PhoneNumber' },
			{
				kind: 'OBJECT',
				name: 'Query',
				fields: [
					{
						name: 'appDashboards',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'AppDashboard', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'appManagement',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppManagement', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'appNextSession',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppNextSession', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'context',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'sessionId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'appPlaybackInfo',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppPlaybackInfo', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'maxHeight',
								type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null }
							},
							{
								name: 'sessionId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'appScreen',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppScreenData', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'screenId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'appSkipSegments',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'AppSkipSegment', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'sessionId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'apps',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'AppInfo', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'me',
						type: { kind: 'OBJECT', name: 'User', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'network',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Network', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'pairing',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Pairing', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'phoneConnection',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'PhoneConnection', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'suggestedApps',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'SuggestedApp', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'user',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'User', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'id',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'users',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'User', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: [
							{
								name: 'limit',
								type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null }
							},
							{
								name: 'offset',
								type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null }
							},
							{
								name: 'orderBy',
								type: {
									kind: 'INPUT_OBJECT',
									name: 'UserOrderInputArgument',
									ofType: null,
									__proto__: null
								}
							},
							{
								name: 'where',
								type: {
									kind: 'INPUT_OBJECT',
									name: 'UserWhereInputArgument',
									ofType: null,
									__proto__: null
								}
							}
						]
					},
					{
						name: 'wifiManagement',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'WifiManagement', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{ kind: 'ENUM', name: 'SortingParameter', enumValues: [{ name: 'asc' }, { name: 'desc' }] },
			{ kind: 'SCALAR', name: 'String' },
			{
				kind: 'INPUT_OBJECT',
				name: 'StringWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'StringWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'StringWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'StringWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContained',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayContains',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'arrayOverlaps',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'eq',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gt',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'gte',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ilike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'in',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'isNotNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'isNull',
						type: { kind: 'SCALAR', name: 'Boolean', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'like',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lt',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'lte',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'ne',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIlike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'notIn',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
							}
						},
						defaultValue: void 0
					},
					{
						name: 'notLike',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{
				kind: 'OBJECT',
				name: 'Subscription',
				fields: [
					{
						name: 'appDashboards',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'AppDashboard', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'appManagement',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppManagement', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'appScreen',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'AppScreenData', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'appId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							},
							{
								name: 'screenId',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'apps',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'AppInfo', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: []
					},
					{
						name: 'phoneConnection',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'PhoneConnection', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'user',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'User', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: [
							{
								name: 'id',
								type: {
									kind: 'NON_NULL',
									ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
								}
							}
						]
					},
					{
						name: 'users',
						type: {
							kind: 'NON_NULL',
							ofType: {
								kind: 'LIST',
								ofType: {
									kind: 'NON_NULL',
									ofType: { name: 'User', kind: 'OBJECT', ofType: null, __proto__: null }
								}
							}
						},
						args: [
							{
								name: 'limit',
								type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null }
							},
							{
								name: 'offset',
								type: { kind: 'SCALAR', name: 'Int', ofType: null, __proto__: null }
							},
							{
								name: 'orderBy',
								type: {
									kind: 'INPUT_OBJECT',
									name: 'UserOrderInputArgument',
									ofType: null,
									__proto__: null
								}
							},
							{
								name: 'where',
								type: {
									kind: 'INPUT_OBJECT',
									name: 'UserWhereInputArgument',
									ofType: null,
									__proto__: null
								}
							}
						]
					},
					{
						name: 'wifiManagement',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'WifiManagement', kind: 'OBJECT', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'SuggestedApp',
				fields: [
					{
						name: 'description',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'icon',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'id',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'image',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'name',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'publicKey',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'User',
				fields: [
					{
						name: 'createdAt',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'DateTime', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'id',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'ID', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'image',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'pinHash',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'updatedAt',
						type: { kind: 'SCALAR', name: 'DateTime', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'username',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'INPUT_OBJECT',
				name: 'UserOrderInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'createdAt',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'id',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'image',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'pinHash',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'updatedAt',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					},
					{
						name: 'username',
						type: { kind: 'ENUM', name: 'SortingParameter', ofType: null, __proto__: null },
						defaultValue: void 0
					}
				]
			},
			{
				kind: 'INPUT_OBJECT',
				name: 'UserWhereInputArgument',
				isOneOf: void 0,
				inputFields: [
					{
						name: 'AND',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'UserWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'NOT',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'UserWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'OR',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: {
									name: 'UserWhereInputArgument',
									kind: 'INPUT_OBJECT',
									ofType: null,
									__proto__: null
								}
							}
						},
						defaultValue: void 0
					},
					{
						name: 'createdAt',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'DateTimeWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'id',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'IDWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'image',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'StringWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'pinHash',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'StringWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'updatedAt',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'DateTimeWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					},
					{
						name: 'username',
						type: {
							kind: 'INPUT_OBJECT',
							name: 'StringWhereInputArgument',
							ofType: null,
							__proto__: null
						},
						defaultValue: void 0
					}
				]
			},
			{
				kind: 'OBJECT',
				name: 'WifiManagement',
				fields: [
					{
						name: 'available',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'connectingSsid',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'errorMessage',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					},
					{
						name: 'ethernet',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'mode',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'networks',
						type: {
							kind: 'LIST',
							ofType: {
								kind: 'NON_NULL',
								ofType: { name: 'WifiNetwork', kind: 'OBJECT', ofType: null, __proto__: null }
							}
						},
						args: []
					},
					{
						name: 'online',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'scanning',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'ssid',
						type: { kind: 'SCALAR', name: 'String', ofType: null, __proto__: null },
						args: []
					}
				],
				interfaces: []
			},
			{
				kind: 'OBJECT',
				name: 'WifiNetwork',
				fields: [
					{
						name: 'saved',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Boolean', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'security',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'signal',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'Int', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					},
					{
						name: 'ssid',
						type: {
							kind: 'NON_NULL',
							ofType: { name: 'String', kind: 'SCALAR', ofType: null, __proto__: null }
						},
						args: []
					}
				],
				interfaces: []
			}
		],
		directives: []
	}
} as IntrospectionQuery;
