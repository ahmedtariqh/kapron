CREATE TABLE IF NOT EXISTS kapron_model_quota (
  owner TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  reserved INTEGER NOT NULL CHECK (reserved >= 0),
  PRIMARY KEY (owner, utc_day)
);
