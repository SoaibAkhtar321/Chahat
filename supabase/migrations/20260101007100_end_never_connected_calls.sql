-- 20260101007100_end_never_connected_calls.sql
-- Phase 1 (call timer fixes). Forward-only; no table, policy or RPC signature changes.
--
-- Problem: a call can stay 'accepted' even though nobody is in it any more (the app was closed or killed
-- before both phones connected). Such a row kept using up the caller's daily free seconds until its free
-- window ran out, so the NEXT call found no free time left and silently took the paid-minute path.
--
-- Fix: expire_video_calls (run every minute by the existing cron job) also ends an accepted call that
-- never reached "both phones connected" within call_never_connected_seconds of being accepted (default
-- 45 s, 20-300). ended_at is set to accepted_at, so the call uses no allowance at all
-- (call_allowance_used_today counts from allowance_started_at / connected_at / accepted_at + grace).
-- Everything else in the function is unchanged from 20260101002700.
BEGIN;

INSERT INTO public.app_settings (key, value) VALUES ('call_never_connected_seconds', '45'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.expire_video_calls(_limit integer DEFAULT 500, _users uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _cap integer;
  _never integer;
  _timed_out integer := 0;
  _ended integer := 0;
  _abandoned integer := 0;
  _purged integer := 0;
BEGIN
  IF _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
  _cap := public.billing_setting_int('call_max_duration_seconds', 10800, 600, 86400);
  _never := public.billing_setting_int('call_never_connected_seconds', 45, 20, 300);

  WITH due AS (
    SELECT c.id FROM public.video_calls c
    WHERE c.status = 'pending' AND c.expires_at <= now()
      AND (_users IS NULL OR c.caller_id = ANY (_users) OR c.recipient_id = ANY (_users))
    ORDER BY c.expires_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_calls c
  SET status = 'timed_out', ended_at = now()
  FROM due
  WHERE c.id = due.id AND c.status = 'pending';
  GET DIAGNOSTICS _timed_out = ROW_COUNT;

  -- Accepted but never connected: nobody was ever in the call together, so it costs nothing.
  WITH due AS (
    SELECT c.id FROM public.video_calls c
    WHERE c.status = 'accepted' AND c.accepted_at IS NOT NULL
      AND c.connected_at IS NULL
      AND c.accepted_at + make_interval(secs => _never) <= now()
      AND (_users IS NULL OR c.caller_id = ANY (_users) OR c.recipient_id = ANY (_users))
    ORDER BY c.accepted_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_calls c
  SET status = 'ended', ended_at = c.accepted_at
  FROM due
  WHERE c.id = due.id AND c.status = 'accepted';
  GET DIAGNOSTICS _abandoned = ROW_COUNT;

  -- Accepted calls end when the server-authorised time lapses (free minute / prepaid minutes), or,
  -- for unmetered calls, at the maximum duration. ended_at is the authorised end, never later.
  WITH due AS (
    SELECT c.id FROM public.video_calls c
    WHERE c.status = 'accepted' AND c.accepted_at IS NOT NULL
      AND (
        (c.free_call_until IS NOT NULL AND c.free_call_until <= now())
        OR (c.free_call_until IS NULL AND c.accepted_at + make_interval(secs => _cap) <= now())
      )
      AND (_users IS NULL OR c.caller_id = ANY (_users) OR c.recipient_id = ANY (_users))
    ORDER BY c.accepted_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_calls c
  SET status = 'ended',
      ended_at = least(now(), coalesce(c.free_call_until, c.accepted_at + make_interval(secs => _cap)))
  FROM due
  WHERE c.id = due.id AND c.status = 'accepted';
  GET DIAGNOSTICS _ended = ROW_COUNT;

  IF _users IS NULL THEN
    DELETE FROM public.call_events e
    WHERE e.ctid IN (
      SELECT x.ctid FROM public.call_events x
      WHERE x.created_at < now() - interval '1 day' LIMIT 5000
    );
    GET DIAGNOSTICS _purged = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('timed_out', _timed_out, 'ended', _ended + _abandoned,
                            'never_connected', _abandoned, 'events_purged', _purged);
END
$$;
REVOKE EXECUTE ON FUNCTION public.expire_video_calls(integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_video_calls(integer, uuid[]) TO service_role;

COMMIT;
