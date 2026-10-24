// Compiled by strict tsc. Each expected error protects a meaningful channel/persistence boundary.
import type { Id, Quantity, Money } from '../../packages/domain/src/values/index.ts';
import type { TransactionContext } from '../../packages/application/src/ports/transactions.ts';
import type { MoneyV1 } from '../../packages/contracts/src/primitives.ts';
import type { ReportHead } from '../../packages/domain/src/entities/report.ts';
declare const report: Id<'report'>;
// @ts-expect-error an opaque report ID cannot be substituted for its owner
const subject: Id<'subject'> = report;
declare const inches: Quantity<'inch'>;
// @ts-expect-error unit-bearing dimensions cannot be interchanged
const millimetres: Quantity<'mm'> = inches;
// @ts-expect-error services cannot construct a transaction context from an arbitrary object
const tx: TransactionContext = {};
declare const money: Money;
// @ts-expect-error bigint domain money is not its decimal-string wire representation
const wire: MoneyV1 = money;
declare const head: ReportHead;
// @ts-expect-error entity revisions are immutable
head.revision = 1n;
void [subject, millimetres, tx, wire];
