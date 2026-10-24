-- Database-first source of truth. Drizzle records/mappers follow at S2.
CREATE SCHEMA app;
CREATE SCHEMA admin;
CREATE SCHEMA privacy;
CREATE SCHEMA email;
CREATE SCHEMA analytics;

CREATE TABLE app.code_sets (
  code text CONSTRAINT code_sets_pk PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_sets_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT code_sets_description_ck CHECK (length(description) BETWEEN 1 AND 200)
);
CREATE TABLE app.code_values (
  set_code text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_values_pk PRIMARY KEY (set_code, code),
  CONSTRAINT code_values_set_fk FOREIGN KEY (set_code) REFERENCES app.code_sets(code) ON DELETE RESTRICT,
  CONSTRAINT code_values_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT code_values_label_ck CHECK (length(label) BETWEEN 1 AND 200)
);
CREATE TABLE app.countries (
  code text CONSTRAINT countries_pk PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT countries_code_ck CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT countries_label_ck CHECK (length(label) BETWEEN 1 AND 100)
);
CREATE TABLE app.currencies (
  code text CONSTRAINT currencies_pk PRIMARY KEY,
  minor_unit_digits smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_code_ck CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_digits_ck CHECK (minor_unit_digits BETWEEN 0 AND 4)
);
CREATE TABLE app.locales (
  code text CONSTRAINT locales_pk PRIMARY KEY,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locales_code_ck CHECK (code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' AND length(code) <= 35),
  CONSTRAINT locales_label_ck CHECK (length(label) BETWEEN 1 AND 100)
);
CREATE TABLE app.markets (
  code text CONSTRAINT markets_pk PRIMARY KEY,
  country_code text NOT NULL,
  default_locale text NOT NULL,
  currency_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT markets_code_ck CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,15}$'),
  CONSTRAINT markets_country_fk FOREIGN KEY (country_code) REFERENCES app.countries(code) ON DELETE RESTRICT,
  CONSTRAINT markets_locale_fk FOREIGN KEY (default_locale) REFERENCES app.locales(code) ON DELETE RESTRICT,
  CONSTRAINT markets_currency_fk FOREIGN KEY (currency_code) REFERENCES app.currencies(code) ON DELETE RESTRICT
);
CREATE INDEX markets_country_idx ON app.markets(country_code);
CREATE INDEX markets_locale_idx ON app.markets(default_locale);
CREATE INDEX markets_currency_idx ON app.markets(currency_code);
CREATE TABLE app.market_locales (
  market_code text NOT NULL,
  locale_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_locales_pk PRIMARY KEY (market_code, locale_code),
  CONSTRAINT market_locales_market_fk FOREIGN KEY (market_code) REFERENCES app.markets(code) ON DELETE RESTRICT,
  CONSTRAINT market_locales_locale_fk FOREIGN KEY (locale_code) REFERENCES app.locales(code) ON DELETE RESTRICT
);
CREATE INDEX market_locales_locale_idx ON app.market_locales(locale_code);
CREATE TABLE app.units (
  code text CONSTRAINT units_pk PRIMARY KEY,
  quantity_kind text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT units_kind_ck CHECK (quantity_kind IN ('length','distance','pressure','ratio')),
  CONSTRAINT units_label_ck CHECK (length(label) BETWEEN 1 AND 100)
);

-- Reviewed static vocabulary, not imported/licensed tire data or a launch authorization.
INSERT INTO app.code_sets (code, description) VALUES ('asset_purpose', 'Registered storage purposes; attachment services enforce authorization');
INSERT INTO app.code_values (set_code, code, label) VALUES
  ('asset_purpose', 'report_pdf', 'Private report PDF'),
  ('asset_purpose', 'import_source', 'Private import source'),
  ('asset_purpose', 'import_evidence', 'Private import validation evidence'),
  ('asset_purpose', 'agreement', 'Private reviewed agreement'),
  ('asset_purpose', 'cms_media', 'Reviewed CMS media');
INSERT INTO app.countries (code, label) VALUES ('US', 'United States');
INSERT INTO app.currencies (code, minor_unit_digits) VALUES ('USD', 2);
INSERT INTO app.locales (code, label) VALUES ('en-US', 'English (United States)');
INSERT INTO app.markets (code, country_code, default_locale, currency_code) VALUES ('US', 'US', 'en-US', 'USD');
INSERT INTO app.market_locales (market_code, locale_code) VALUES ('US', 'en-US');
INSERT INTO app.units (code, quantity_kind, label) VALUES
  ('mm', 'length', 'Millimetres'), ('in', 'length', 'Inches'),
  ('km', 'distance', 'Kilometres'), ('mi', 'distance', 'Miles'),
  ('kpa', 'pressure', 'Kilopascals'), ('psi', 'pressure', 'Pounds per square inch'),
  ('ratio', 'ratio', 'Unitless ratio');

GRANT USAGE ON SCHEMA app TO tt_app_runtime, tt_staff_runtime, tt_asset_runtime;
GRANT SELECT ON app.code_sets, app.code_values, app.countries, app.currencies,
  app.locales, app.markets, app.market_locales, app.units TO tt_app_runtime, tt_staff_runtime, tt_asset_runtime;
-- No grants on privacy/email/analytics, migration metadata or future tables.
