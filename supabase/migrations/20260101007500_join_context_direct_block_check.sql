-- 20260101007500_join_context_direct_block_check.sql
-- Audit fix for WhatsApp-style blocking (20260101007200). Forward-only; no table or policy changes.
--
-- get_call_join_context decides whether a call may still be joined (call token). It checked blocks with
-- is_blocked_pair(), which only answers for the signed-in user (auth.uid()); this function runs as service_role,
-- so the check was always false. Blocking used to delete the match, which made the pair ineligible anyway.
-- Blocking now keeps the match, so the block is checked directly in public.blocks (either direction).
-- Everything else in the function is unchanged from 20260101005800.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_call_join_context(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _eligible boolean;
  _start timestamptz;
BEGIN
  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id FOR UPDATE;
  IF _call.id IS NULL OR _user_id IS NULL OR _user_id NOT IN (_call.caller_id, _call.recipient_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  _eligible := EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      -- Direct lookup: is_blocked_pair() only answers for the signed-in user, and this runs as service_role
      -- (no auth.uid()), so it was always false here. It only worked because blocking used to delete the match.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.blocker = m.user_a AND b.blocked = m.user_b) OR (b.blocker = m.user_b AND b.blocked = m.user_a)
      )
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  );

  IF _eligible AND _call.status = 'accepted' AND _call.accepted_at IS NOT NULL
     AND (_call.free_call_until IS NULL OR _call.free_call_until > now()) THEN
    IF _user_id = _call.caller_id THEN
      UPDATE public.video_calls SET caller_join_granted_at = coalesce(caller_join_granted_at, now())
        WHERE id = _call.id RETURNING * INTO _call;
    ELSE
      UPDATE public.video_calls SET recipient_join_granted_at = coalesce(recipient_join_granted_at, now())
        WHERE id = _call.id RETURNING * INTO _call;
    END IF;

    -- Both participants can now be in the channel: start the allowance clock and bound the window.
    IF _call.allowance_started_at IS NULL
       AND _call.caller_join_granted_at IS NOT NULL AND _call.recipient_join_granted_at IS NOT NULL
       AND _call.free_call_until IS NOT NULL AND coalesce(_call.billing_free_seconds, 0) > 0
       AND _call.billed_minutes = 0 THEN
      _start := greatest(_call.caller_join_granted_at, _call.recipient_join_granted_at)
                + make_interval(secs => public.billing_setting_int('call_join_slack_seconds', 0, 0, 10));
      UPDATE public.video_calls
        SET allowance_started_at = _start,
            free_call_until = least(free_call_until, _start + make_interval(secs => billing_free_seconds))
        WHERE id = _call.id RETURNING * INTO _call;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', _call.status,
    'call_type', _call.call_type,
    'eligible', _eligible,
    'accepted', _call.accepted_at IS NOT NULL,
    'free_seconds_remaining',
      CASE WHEN _call.free_call_until IS NULL THEN NULL
        ELSE greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer) END,
    'billing_exempt', _call.billing_exempt,
    'extension_lead_seconds', public.billing_setting_int('call_extension_lead_seconds', 20, 1, 50)
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) TO service_role;

COMMIT;
