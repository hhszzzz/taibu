-- Preserve administrator JWT and owner-executed RPC writes while protecting
-- account entitlements and ledger integrity from direct ordinary-user writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

LOCK TABLE public.users, public.credit_transactions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    v_users_owner oid;
BEGIN
    SELECT relowner INTO v_users_owner
    FROM pg_catalog.pg_class
    WHERE oid = 'public.users'::regclass;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN ('public.users'::regclass, 'public.credit_transactions'::regclass)
          AND (c.relkind <> 'r' OR NOT c.relrowsecurity OR c.relforcerowsecurity
               OR c.relowner <> v_users_owner
               OR pg_catalog.pg_get_userbyid(c.relowner) IN ('anon', 'authenticated', 'service_role'))
    ) THEN
        RAISE EXCEPTION 'Account protection requires owner-controlled tables with RLS enabled and FORCE RLS disabled';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('id', 'uuid'::regtype, NULL::text),
            ('is_admin', 'boolean'::regtype, 'false'),
            ('membership', 'text'::regtype, '''free''::text'),
            ('membership_expires_at', 'timestamptz'::regtype, NULL::text),
            ('ai_chat_count', 'integer'::regtype, '1')
        ) AS expected(name, type_oid, default_expression)
        LEFT JOIN pg_catalog.pg_attribute a
          ON a.attrelid = 'public.users'::regclass
         AND a.attname = expected.name AND a.attnum > 0 AND NOT a.attisdropped
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum IS NULL OR a.atttypid <> expected.type_oid
           OR pg_catalog.pg_get_expr(d.adbin, d.adrelid) IS DISTINCT FROM expected.default_expression
    ) THEN
        RAISE EXCEPTION 'Account protection requires the reviewed identity, entitlement types and free/one-credit defaults';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('public.is_admin_user()'),
            ('public.decrement_ai_chat_count(uuid)'),
            ('public.increment_ai_chat_count(uuid,integer)'),
            ('public.record_credit_transaction(uuid,integer,text,text,integer,text,text,text,jsonb)')
        ) AS expected(signature)
        LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(expected.signature)
        WHERE p.oid IS NULL OR NOT p.prosecdef OR p.proowner <> v_users_owner
    ) THEN
        RAISE EXCEPTION 'Account protection requires the existing owner-executed administrator and credit functions';
    END IF;

    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.is_admin_user()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',
           'public.record_credit_transaction(uuid,integer,text,text,integer,text,text,text,jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Apply the ledger RPC restriction first and retain authenticated administrator checks';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_user_entitlement_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_owner name;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

    -- Effective SQL identity survives nested SECURITY DEFINER RPCs. Never use
    -- session_user or the JWT role to decide whether this is an owner write.
    IF current_user = v_owner OR current_user = 'service_role' THEN
        RETURN NEW;
    END IF;
    IF current_user = 'authenticated' AND public.is_admin_user() IS TRUE THEN
        RETURN NEW;
    END IF;

    IF current_user <> 'authenticated' OR auth.uid() IS NULL
       OR NEW.id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Account writes require the authenticated owner' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_admin IS DISTINCT FROM false
           OR NEW.membership IS DISTINCT FROM 'free'::text
           OR NEW.membership_expires_at IS NOT NULL
           OR NEW.ai_chat_count IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'Account entitlement changes require administrator authority' USING ERRCODE = '42501';
        END IF;
    ELSIF ROW(NEW.id, NEW.is_admin, NEW.membership, NEW.membership_expires_at, NEW.ai_chat_count)
          IS DISTINCT FROM
          ROW(OLD.id, OLD.is_admin, OLD.membership, OLD.membership_expires_at, OLD.ai_chat_count) THEN
        RAISE EXCEPTION 'Account entitlement changes require administrator authority' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_entitlement_writes() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_user_entitlement_writes ON public.users;
CREATE TRIGGER guard_user_entitlement_writes
    BEFORE INSERT OR UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.guard_user_entitlement_writes();

-- Restrictive policies are ANDed with all existing permissive policies, so an
-- earlier own-row INSERT policy cannot reopen the ordinary-user ledger path.
DROP POLICY IF EXISTS credit_transactions_authenticated_insert_guard ON public.credit_transactions;
CREATE POLICY credit_transactions_authenticated_insert_guard
    ON public.credit_transactions AS RESTRICTIVE
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_user() IS TRUE);

COMMIT;
