import { z } from './phase2-wire.ts';
const count = z.string().regex(/^[0-9]{1,19}$/),
  text = z.string().max(2048);
export const pilotHealthView = z.object({
  accepted: count,
  uncertain: count,
  delivered: count,
  bounced: count,
  complained: count,
  suspectedHumanOpens: count,
  machineOpens: count,
  unknownOpens: count,
  suspectedHumanClicks: count,
  machineClicks: count,
  unknownClicks: count,
  week: text,
  grain: text,
  deliveryIsIndependentFact: z.literal(true),
  opensAreEstimates: z.literal(true),
  domainAttribution: text,
});
