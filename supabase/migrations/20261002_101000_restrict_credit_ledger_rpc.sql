-- Ledger writes are internal to the owner-executed credit/check-in/key RPCs.
-- Browser users (including an admin login session) must not insert arbitrary
-- ledger rows by invoking this SECURITY DEFINER helper directly.
BEGIN;

ALTER FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb)
    SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_transaction(uuid, integer, text, text, integer, text, text, text, jsonb)
    TO service_role;

COMMIT;
