CREATE TABLE "bug_report_rate_limit" (
	"key" text NOT NULL,
	"window" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bug_report_rate_limit_key_window_pk" PRIMARY KEY("key","window")
);
