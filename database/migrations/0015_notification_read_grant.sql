-- Notifications are server-authored. Users can only acknowledge their own
-- notices; the existing RLS policies continue to enforce row ownership.
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
