-- Superuser bootstrap: roles, schemas, extensions and database-level defaults.
-- Idempotent; safe to run before every deployment. Passwords are NOT set here:
-- scripts/db/bootstrap.mjs applies them from the environment after this file.
-- Run against the application database (default: taibu).

DO $$
BEGIN
  IF current_user <> 'postgres' AND NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
  ) THEN
    RAISE EXCEPTION 'bootstrap must run as a superuser';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_owner') THEN
    CREATE ROLE taibu_owner NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_migrator') THEN
    CREATE ROLE taibu_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_app') THEN
    CREATE ROLE taibu_app LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_auth') THEN
    CREATE ROLE taibu_auth LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_backup') THEN
    CREATE ROLE taibu_backup LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Non-login RPC role. Application connections can only SET anon/authenticated.
    CREATE ROLE service_role NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE taibu_owner BYPASSRLS;
ALTER ROLE taibu_backup BYPASSRLS;
ALTER ROLE taibu_app NOINHERIT;
ALTER ROLE taibu_app SET search_path = public, extensions;
ALTER ROLE taibu_app SET statement_timeout = '15s';
ALTER ROLE taibu_app SET lock_timeout = '5s';
ALTER ROLE taibu_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE taibu_auth SET search_path = identity;
ALTER ROLE taibu_auth SET statement_timeout = '15s';
ALTER ROLE taibu_auth SET lock_timeout = '5s';
ALTER ROLE taibu_auth SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE taibu_migrator SET statement_timeout = '0';
ALTER ROLE taibu_migrator SET lock_timeout = '10s';

GRANT taibu_owner TO taibu_migrator;
GRANT anon TO taibu_app WITH INHERIT FALSE, SET TRUE;
GRANT authenticated TO taibu_app WITH INHERIT FALSE, SET TRUE;
GRANT pg_read_all_data TO taibu_backup;

CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION taibu_owner;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION taibu_owner;
CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION taibu_owner;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- PostgreSQL 15+ gives public to pg_database_owner; taibu_owner must own it
-- to create the current objects inside a transaction with SET LOCAL ROLE.
ALTER SCHEMA public OWNER TO taibu_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO taibu_app;
GRANT USAGE ON SCHEMA identity TO taibu_auth;

-- New functions owned by taibu_owner stay unexecutable until granted explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE taibu_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE taibu_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE SET ON PARAMETER session_replication_role FROM taibu_migrator;
