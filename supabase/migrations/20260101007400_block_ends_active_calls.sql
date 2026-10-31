-- 20260101007400_block_ends_active_calls.sql
-- Audit fix for Phases 1-5. Forward-only; no table or policy changes.
--
-- Before WhatsApp-style blocking (20260101007200) a block deleted the match, and the delete also removed any call
-- that was ringing or running between the two people. Blocking now keeps the match, so such a call would have kept
-- ringing or running. Blocking someone now closes any pending (cancelled) or accepted (ended) call between the pair
-- in the same transaction; the existing video_calls_settle_billing trigger settles any prepaid minutes.
-- The match, chat, messages and swipes still stay.
BEGIN;

CREATE OR REPLACE FUNCTION public.on_block_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF NEW.blocker ~* _uuid_re AND NEW.blocked ~* _uuid_re THEN
    UPDATE public.video_calls c
       SET status = CASE WHEN c.status = 'pending' THEN 'cancelled' ELSE 'ended' END,
           ended_at = now()
     WHERE c.status IN ('pending', 'accepted')
       AND ((c.caller_id = NEW.blocker::uuid AND c.recipient_id = NEW.blocked::uuid)
         OR (c.caller_id = NEW.blocked::uuid AND c.recipient_id = NEW.blocker::uuid));
  END IF;
  -- Deliberately nothing else: the match, its messages and the swipes stay (WhatsApp-style block).
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.on_block_cleanup() FROM PUBLIC, anon, authenticated;

COMMIT;
