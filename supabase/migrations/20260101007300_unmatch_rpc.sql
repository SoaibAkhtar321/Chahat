-- 20260101007300_unmatch_rpc.sql
-- Phase 4 (unmatch). Forward-only; no table or policy changes.
--
-- Unmatching used to be a bare client-side DELETE on public.matches. If a call was ringing or running on that
-- match, the call row vanished mid-call (cascade) and any prepaid call minutes were never settled. This RPC
-- does it in the right order, in one transaction:
--   1. checks the caller is one of the two people in the match;
--   2. closes any pending/accepted call on the match (cancel / end), which runs the existing billing settlement;
--   3. deletes the match (messages, reactions and call history cascade, exactly as before).
-- Swipes are deliberately kept, so the two people do not reappear in each other's Discover.
-- The other person is not notified; their chat disappears the next time their app checks.
BEGIN;

CREATE OR REPLACE FUNCTION public.unmatch_user(_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _deleted integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _match_id IS NULL THEN RAISE EXCEPTION 'Match required'; END IF;

  PERFORM 1 FROM public.matches m
   WHERE m.id = _match_id AND _uid IN (m.user_a, m.user_b)
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Already gone (the other person unmatched first) or never theirs: nothing to do.
    RETURN jsonb_build_object('success', true, 'already_gone', true);
  END IF;

  UPDATE public.video_calls
     SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE 'ended' END,
         ended_at = now()
   WHERE match_id = _match_id AND status IN ('pending', 'accepted');

  DELETE FROM public.matches WHERE id = _match_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN jsonb_build_object('success', _deleted = 1, 'already_gone', false);
END
$$;
REVOKE EXECUTE ON FUNCTION public.unmatch_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmatch_user(uuid) TO authenticated;

COMMIT;
