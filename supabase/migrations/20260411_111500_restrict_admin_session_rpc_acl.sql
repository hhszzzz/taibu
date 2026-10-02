REVOKE ALL ON FUNCTION public.admin_list_mcp_keys(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_mcp_keys(boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_revoke_mcp_key(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_mcp_key(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_unban_mcp_key(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_mcp_key(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mcp_reset_key(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_reset_key(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mcp_exchange_authorization_code(text, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_exchange_authorization_code(text, text, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mcp_rotate_refresh_token(text, text, text, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_rotate_refresh_token(text, text, text, text, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mcp_verify_api_key(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_verify_api_key(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mcp_touch_key_last_used(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_touch_key_last_used(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit_slot_as_admin(text, text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_slot_as_admin(text, text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.process_scheduled_reminder_delivery_as_service(uuid, timestamptz, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_scheduled_reminder_delivery_as_service(uuid, timestamptz, text, text, text) TO authenticated, service_role;
