CREATE TABLE kapron_job (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  definition TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  outputs TEXT NOT NULL DEFAULT '[]',
  lease TEXT,
  updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX kapron_job_queue ON kapron_job(status,updated);
--> statement-breakpoint
CREATE INDEX kapron_job_owner ON kapron_job(owner,updated);
--> statement-breakpoint
CREATE TABLE kapron_trigger (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  workflow TEXT NOT NULL,
  interval_ms INTEGER NOT NULL,
  due INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX kapron_trigger_due ON kapron_trigger(due);
--> statement-breakpoint
CREATE TABLE kapron_share (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE kapron_api_key (
  hash TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE kapron_project_space (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  document TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE kapron_project_member (
  space TEXT NOT NULL,
  member TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (space,member)
);
--> statement-breakpoint
CREATE INDEX kapron_member_lookup ON kapron_project_member(member,space);
--> statement-breakpoint
CREATE TABLE kapron_project_invite (
  code TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  role TEXT NOT NULL,
  expires INTEGER NOT NULL
);
