-- Live source compatibility found historic campaigns with no defect narrative.
-- Retain the warning and explicit unknown; never invent a description or drop it.
ALTER TABLE app.recalls ALTER COLUMN summary DROP NOT NULL;
