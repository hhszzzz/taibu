import { oneOf, union, type Annotations, type Schema } from '@earendil-works/pi-schema';

/**
 * TypeBox's string literal and string enum, which pi-schema's lit() and oneOf() write without `type`: with these the
 * tools keep the JSON Schema the model has always been given.
 */
export const literal = <const V extends string>(value: V) => ({ type: 'string', const: value }) as Schema<V>;

/** One of `values`, as `Type.Union(values.map(Type.Literal))` wrote it. */
export const literals = <const V extends string>(values: readonly V[]) => union(values.map(literal));

/** A string from `values`, as `Type.String({ enum })` wrote it. */
export const stringEnum = <const V extends readonly string[]>(values: V, options?: Annotations<V[number]>) =>
  ({ type: 'string', ...oneOf(values, options) }) as Schema<V[number]>;
