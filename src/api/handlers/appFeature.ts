// The manifest's features as a GraphQL enum, so the generated client knows the
// same names as the SDK instead of plain strings.
import { featureSchema } from '@pivi/sdk/manifest';
import { schemaBuilder } from '../rumble';

export const AppFeatureEnum = schemaBuilder.enumType('AppFeature', {
	values: featureSchema.options
});
