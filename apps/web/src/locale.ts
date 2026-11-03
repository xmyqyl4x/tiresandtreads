export const locale = 'en-US' as const;
const number = new Intl.NumberFormat(locale),
  currency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }),
  date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
export const display = {
  number: (value: number) => number.format(value),
  currency: (minor: number) => currency.format(minor / 100),
  date: (value: Date) => date.format(value),
};
