-- 20260101007200_whatsapp_style_blocking.sql
-- Phase 2 (blocking, backend). Forward-only; no table drops.
--
-- Goal: block like WhatsApp.
--   * Blocking no longer deletes the match, the chat or the messages. Both people keep the chat.
--   * The BLOCKED person can still send. Their message is saved, but it is never shown to the blocker and
--     never marked delivered, so the sender just sees one tick (no error, no "you are blocked" message).
--     This works by adding the blocker to message_user_deletions for that message (the same per-user hide
--     that "Delete for me" uses), so every existing reader already hides it from the blocker.
--   * The BLOCKER cannot send to someone they blocked (they must unblock first); the app shows that.
--   * The blocker still sees the blocked person's profile. The blocked person sees only the name
--     (no photos / about / interests), like WhatsApp hiding the profile photo.
--   * Calls and discovery stay blocked both ways (unchanged).
BEGIN;

-- ---------- 1. Direction-aware helpers ----------
-- True when the signed-in user has blocked _other.
CREATE OR REPLACE FUNCTION public.i_blocked(_other text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker = auth.uid()::text AND b.blocked = _other)
$$;
-- True when _other has blocked the signed-in user.
CREATE OR REPLACE FUNCTION public.blocked_me(_other text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker = _other AND b.blocked = auth.uid()::text)
$$;
-- True when the signed-in user has blocked the other person of this match.
CREATE OR REPLACE FUNCTION public.i_blocked_match_partner(_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = _match AND auth.uid() IS NOT NULL AND auth.uid()::text IN (m.user_a, m.user_b)
      AND public.i_blocked(CASE WHEN m.user_a = auth.uid()::text THEN m.user_b ELSE m.user_a END)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.i_blocked(text), public.blocked_me(text), public.i_blocked_match_partner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_blocked(text), public.blocked_me(text), public.i_blocked_match_partner(uuid) TO authenticated;

-- ---------- 2. Blocking keeps the match and the chat ----------
CREATE OR REPLACE FUNCTION public.on_block_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Deliberately nothing: the match, its messages and the swipes stay (WhatsApp-style block).
  RETURN NEW;
END $$;

-- ---------- 3. Both people stay members of the chat ----------
CREATE OR REPLACE FUNCTION public.is_match_member(_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = _match AND auth.uid() IS NOT NULL AND auth.uid()::text IN (m.user_a, m.user_b)
  )
$$;
CREATE OR REPLACE FUNCTION public.chat_folder_member(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id::text = _folder AND auth.uid() IS NOT NULL AND auth.uid()::text IN (m.user_a, m.user_b)
  )
$$;
DROP POLICY IF EXISTS "members read match" ON public.matches;
CREATE POLICY "members read match" ON public.matches FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid()::text IN (user_a, user_b));

-- ---------- 4. Sending: the blocked person may send (hidden from the blocker); the blocker may not ----------
DROP POLICY IF EXISTS "members send messages" ON public.messages;
CREATE POLICY "members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth.uid()::text
    AND public.is_match_member(match_id)
    AND (body <> '' OR image_path IS NOT NULL OR audio_path IS NOT NULL)
    AND (image_path IS NULL OR public.is_valid_chat_media_path(image_path, match_id))
    AND (audio_path IS NULL OR public.is_valid_chat_media_path(audio_path, match_id))
    AND NOT public.i_blocked_match_partner(match_id)
  );

-- A message from someone the recipient has blocked is stored but hidden from the recipient.
CREATE OR REPLACE FUNCTION public.messages_withhold_if_blocked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _recipient text;
BEGIN
  IF NEW.message_type = 'system' THEN RETURN NEW; END IF;
  SELECT CASE WHEN m.user_a = NEW.sender THEN m.user_b ELSE m.user_a END INTO _recipient
  FROM public.matches m WHERE m.id = NEW.match_id;
  IF _recipient IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker = _recipient AND b.blocked = NEW.sender)
     AND _recipient ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    INSERT INTO public.message_user_deletions (message_id, user_id)
    VALUES (NEW.id, _recipient::uuid)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_withhold_if_blocked() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_withhold_if_blocked ON public.messages;
CREATE TRIGGER messages_withhold_if_blocked AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_withhold_if_blocked();

-- The recipient can only mark messages they can see (a withheld message must never become "delivered" or "read").
DROP POLICY IF EXISTS "recipient marks read" ON public.messages;
CREATE POLICY "recipient marks read" ON public.messages FOR UPDATE TO authenticated
  USING (public.is_match_member(match_id) AND sender <> auth.uid()::text AND NOT public.message_hidden_for_caller(id))
  WITH CHECK (public.is_match_member(match_id) AND sender <> auth.uid()::text);

CREATE OR REPLACE FUNCTION public.mark_messages_delivered(_match_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _count integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.messages m
     SET delivered_at = now()
   WHERE m.delivered_at IS NULL
     AND m.deleted_at IS NULL
     AND m.sender <> _uid::text
     AND (_match_id IS NULL OR m.match_id = _match_id)
     AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid)
     AND EXISTS (
       SELECT 1 FROM public.matches mt
       WHERE mt.id = m.match_id AND _uid::text IN (mt.user_a, mt.user_b)
     );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;
REVOKE EXECUTE ON FUNCTION public.mark_messages_delivered(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_chat_read(_match_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid text := auth.uid()::text;
  _count integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _match_id IS NULL OR NOT public.is_match_member(_match_id) THEN RAISE EXCEPTION 'Not a member of this match'; END IF;
  UPDATE public.messages m
     SET read_at = now()
   WHERE m.match_id = _match_id
     AND m.sender <> _uid
     AND m.read_at IS NULL
     AND m.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid::uuid);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;
REVOKE EXECUTE ON FUNCTION public.mark_chat_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_chat_read(uuid) TO authenticated;

-- ---------- 5. Chat list state: blocked chats stay in the list (copied from 20260101005900 minus the block filter) ----------
CREATE OR REPLACE FUNCTION public.get_chat_list_state(_match_ids uuid[] DEFAULT NULL)
RETURNS TABLE (match_id uuid, unread_count integer, last_message_id uuid, last_message_read boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _receipts boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _match_ids IS NOT NULL AND cardinality(_match_ids) > 200 THEN RAISE EXCEPTION 'Too many matches'; END IF;
  _receipts := public.get_active_subscription_tier(_uid::text) IN ('plus', 'vip');

  RETURN QUERY
  WITH mine AS (
    SELECT mt.id
    FROM public.matches mt
    WHERE _uid::text IN (mt.user_a, mt.user_b)
      AND (_match_ids IS NULL OR mt.id = ANY (_match_ids))
  )
  SELECT
    mine.id,
    (SELECT count(*)::integer FROM public.messages m
      WHERE m.match_id = mine.id AND m.sender <> _uid::text AND m.read_at IS NULL AND m.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid)),
    last.id,
    CASE WHEN last.id IS NULL THEN NULL
         WHEN last.sender <> _uid::text THEN last.read_at IS NOT NULL   -- my own reading: always visible
         WHEN _receipts THEN last.read_at IS NOT NULL                   -- the other person's reading: Plus/VIP
         ELSE NULL END
  FROM mine
  LEFT JOIN LATERAL (
    SELECT m.id, m.sender, m.read_at FROM public.messages m
    WHERE m.match_id = mine.id
      AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) last ON true;
END
$$;

-- ---------- 6. Profiles: the blocker still sees the person; the blocked person sees the name only ----------
CREATE OR REPLACE FUNCTION public.get_public_profile(_id text)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb, photos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name,
         CASE WHEN p.dob IS NULL OR public.blocked_me(p.id) THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         CASE WHEN public.blocked_me(p.id) THEN NULL ELSE p.city END,
         CASE WHEN public.blocked_me(p.id) THEN NULL ELSE p.bio END,
         CASE WHEN public.blocked_me(p.id) THEN NULL ELSE p.work END,
         CASE WHEN public.blocked_me(p.id) THEN NULL ELSE p.education END,
         CASE WHEN public.blocked_me(p.id) THEN '{}'::text[] ELSE p.interests END,
         CASE WHEN public.blocked_me(p.id) THEN '{}'::text[] ELSE p.intents END,
         CASE WHEN public.blocked_me(p.id) THEN '{}'::text[] ELSE p.languages END,
         CASE WHEN public.blocked_me(p.id) THEN '{}'::jsonb ELSE p.lifestyle END,
         CASE WHEN public.blocked_me(p.id) THEN NULL ELSE p.prompt END,
         CASE
           WHEN p.id = auth.uid()::text THEN public.owner_photos(p.id, p.photos)
           WHEN p.status = 'active' AND p.onboarded AND NOT public.blocked_me(p.id)
             THEN public.public_photos(p.id, p.photos)
           ELSE '[]'::jsonb END
  FROM public.profiles p
  WHERE p.id = _id AND auth.uid() IS NOT NULL AND (
    p.id = auth.uid()::text
    OR (
      p.status = 'active'
      AND (
        -- people you share a chat with stay visible in the chat even after a block (blocked people see the name only)
        EXISTS (
          SELECT 1 FROM public.matches m
          WHERE auth.uid()::text IN (m.user_a, m.user_b) AND p.id IN (m.user_a, m.user_b)
        )
        OR (p.onboarded AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
      )
    )
  )
$$;

COMMIT;
