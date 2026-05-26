-- Drop device login flow. The CLI login command was removed; DeviceLogin had no remaining consumers.
DROP TABLE IF EXISTS "DeviceLogin";
