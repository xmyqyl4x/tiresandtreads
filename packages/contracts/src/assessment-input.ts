import './browser-runtime.ts';
import {
  strictObject,
  uuid,
  literal,
  string,
  nullable,
  optional,
  number,
  int,
  minimum,
  maximum,
  minLength,
  maxLength,
  regex,
  array,
  enum as enumeration,
} from 'zod/mini';
export const assessmentInputSchema = strictObject({
  market: literal('US'),
  regionKey: string().check(minLength(1), maxLength(80)),
  configurationId: nullable(uuid()),
  wheelPackage: nullable(string().check(minLength(1), maxLength(200))),
  sizes: nullable(
    strictObject({
      front: string().check(minLength(1), maxLength(80)),
      rear: string().check(minLength(1), maxLength(80)),
    }),
  ),
  strategy: enumeration(['year_round', 'summer_set', 'winter_set']),
  winterUse: enumeration(['none', 'snow', 'ice', 'unknown']),
  replace: array(enumeration(['front_left', 'front_right', 'rear_left', 'rear_right'])).check(
    minLength(1),
    maxLength(4),
  ),
  priorities: array(
    enumeration([
      'wet',
      'longevity',
      'comfort',
      'dry',
      'value',
      'noise',
      'efficiency',
      'snow',
      'ice',
    ]),
  ).check(maxLength(3)),
  budget: nullable(
    strictObject({
      basis: enumeration(['installed', 'merchandise']),
      ceilingMinor: string().check(regex(/^(0|[1-9][0-9]{0,18})$/)),
      currency: literal('USD'),
    }),
  ),
  annualMiles: optional(nullable(number().check(int(), minimum(0), maximum(200000)))),
});
