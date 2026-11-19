CREATE TABLE kapron_workflow_webhook (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  workflow TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(owner, workflow)
);
