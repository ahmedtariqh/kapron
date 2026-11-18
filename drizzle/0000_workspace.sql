CREATE TABLE kapron_workspace (
  owner TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  document TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE kapron_vault (
  owner TEXT NOT NULL,
  connection TEXT NOT NULL,
  provider TEXT NOT NULL,
  sealed TEXT NOT NULL,
  PRIMARY KEY (owner, connection)
);
