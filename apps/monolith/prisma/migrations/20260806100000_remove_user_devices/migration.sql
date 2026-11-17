-- The JPush alias flow no longer uses backend device registrations.
-- user_devices was verified empty in development and test databases before applying this migration.
DROP TABLE "user_devices";
