import { evaluateSyntheticBatch } from './phase2-evaluation.ts';
import { syntheticEvaluationBatch } from '../../tests/fixtures/phase2/evaluation-cases.ts';
if (process.argv.length !== 2)
  throw Error('Synthetic rehearsal accepts no input files or arguments');
console.log(JSON.stringify(evaluateSyntheticBatch(syntheticEvaluationBatch()), null, 2));
