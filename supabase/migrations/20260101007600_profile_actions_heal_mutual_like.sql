-- 20260101007600_profile_actions_heal_mutual_like.sql
-- Forward-only. Replaces get_profile_actions (same signature and result shape) so that a profile opened from a
-- shared link, from Likes or from chat never leaves two members stuck: if BOTH have already liked each other but
-- no match row exists, the match is created here (the same insert record_swipe makes) and "Message" is shown.
-- Everything else is unchanged: no second like, preference check, block / availability rules.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_profile_actions(_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _me public.profiles;
  _them public.profiles;
  _match uuid;
  _my_swipe text;
  _mine_ok boolean;
  _theirs_ok boolean;
  _their_swipe text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Profile required'; END IF;
  IF _id = _uid THEN
    RETURN jsonb_build_object('available', true, 'self', true);
  END IF;

  SELECT * INTO _me FROM public.profiles WHERE id = _uid;
  SELECT * INTO _them FROM public.profiles WHERE id = _id;
  IF _them.id IS NULL OR _them.status <> 'active' OR NOT _them.onboarded OR _them.is_demo
     OR public.is_blocked_pair(_uid, _id) THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT m.id INTO _match FROM public.matches m
  WHERE m.user_a = least(_uid, _id) AND m.user_b = greatest(_uid, _id);

  SELECT s.kind INTO _my_swipe FROM public.swipes s WHERE s.from_id = _uid AND s.to_id = _id;

  -- 007600: both members liked each other but no match row exists (likes recorded before a fix, or a match that
  -- was created and lost). They should simply be matched, exactly as record_swipe would have done.
  IF _match IS NULL AND _my_swipe IN ('like', 'priority')
     AND _me.status = 'active' AND _me.onboarded THEN
    SELECT s.kind INTO _their_swipe FROM public.swipes s WHERE s.from_id = _id AND s.to_id = _uid;
    IF _their_swipe IN ('like', 'priority') THEN
      INSERT INTO public.matches (user_a, user_b) VALUES (least(_uid, _id), greatest(_uid, _id))
        ON CONFLICT (user_a, user_b) DO NOTHING;
      SELECT m.id INTO _match FROM public.matches m
      WHERE m.user_a = least(_uid, _id) AND m.user_b = greatest(_uid, _id);
    END IF;
  END IF;

  _mine_ok := coalesce(_me.seeking, '') = '' OR _them.gender = '' OR _them.gender = _me.seeking;
  _theirs_ok := coalesce(_them.seeking, '') = '' OR coalesce(_me.gender, '') = '' OR _me.gender = _them.seeking;

  RETURN jsonb_build_object(
    'available', true,
    'self', false,
    'match_id', _match,
    'my_swipe', _my_swipe,
    'can_like', _match IS NULL AND coalesce(_my_swipe, 'pass') = 'pass' AND _mine_ok AND _theirs_ok
                AND _me.status = 'active' AND _me.onboarded,
    'reason', CASE
      WHEN _match IS NOT NULL THEN 'matched'
      WHEN _my_swipe IN ('like', 'priority') THEN 'already_liked'
      -- One combined reason: never reveal which side's preference does not fit.
      WHEN NOT (_mine_ok AND _theirs_ok) THEN 'preferences_dont_match'
      ELSE NULL END,
    'your_preference', nullif(_me.seeking, '')
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_profile_actions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_actions(text) TO authenticated;

COMMIT;
