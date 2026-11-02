# Chahat 💛

**Chahat** is a dating app for people who want real connections, not endless scrolling. Meet people near you, match when the interest is mutual, and get to know each other through messages, voice notes and video calls, with safety built in from the start.

Available on Android. Made in India.

---

## Why Chahat?

- **Real people.** A verified badge appears only on profiles that have been approved.
- **Safe by design.** Block, report and unmatch work like you expect. Chats are protected from screenshots.
- **More than text.** Send voice notes, photos, GIFs and reactions, or hear someone's voice on their profile before you match.
- **Fair and simple plans.** Prepaid plans that do not auto-renew. You are never charged by surprise.

---

## What you can do

### Find people
- **Discover:** swipe through profiles chosen for you. Like, pass, or send a priority like.
- **Filters:** age, distance, what people are looking for, interests and languages.
- **Your city, your rules:** choose where you want to meet people.
- **Explore:** browse beyond the main deck.
- **Rewind:** changed your mind about a pass? Take it back (Premium).
- **Matches appear instantly:** when you both like each other, the "It's a match" screen opens right away. No app restart needed.
- **New people show up on their own:** if you have seen everyone, Chahat checks again for new profiles, gently and without draining your battery.

### Talk
- **Chats:** text, photos (including view-once), GIFs and voice notes.
- **Reply to a message** by swiping it right, like on WhatsApp.
- **Reactions:** react to any message with an emoji.
- **Delete messages:** for yourself or for everyone.
- **Read receipts and typing indicator** (read receipts are a Plus/VIP feature, and privacy rules apply to both sides).
- **Voice intro:** record a short hello that shows on your profile.
- **Video calls:** talk face to face, with a floating call window so you can keep using the app.

### Stay safe
- **Verified badge:** shown only on profiles that have been approved. It is never self-declared.
- **Block and unmatch:** a blocked person's messages stay hidden from you, and they cannot reach you.
- **Report:** tell us about anyone who breaks the rules.
- **Safety centre:** tips and tools in one place.
- **Screenshot protection:** screenshots and screen recording are blocked while a chat is open.
- **Private sharing:** share a profile link that contains no name, photo, age or city.
- **Your data is yours:** download your data or delete your account from Settings.

---

## Plans

Chahat is free to use. Paid plans add extra features and are bought through Google Play as **prepaid subscriptions that do not auto-renew**. You see the price in your own currency before you buy.

| Plan | What you get |
|---|---|
| **Free** | Daily likes, matching, chat, voice notes, voice intro, a daily video-call allowance |
| **Premium** | Unlimited likes, more daily video time, see who liked you, see profiles you liked, rewind |
| **Plus** | Everything in Premium, plus read receipts |
| **VIP** | Everything in Plus |

Plan details and prices are managed in Google Play, not inside the app.

---

## Privacy and safety promise

- Shared profile links contain only an anonymous ID.
- Blocked and removed accounts never appear to you again.
- You can export or delete your data at any time.

Legal pages and support: https://chahatlegal.netlify.app

---

## For developers

Everything above is built with:

| Part | Technology |
|---|---|
| App | React Native 0.81 + Expo SDK 54 + Expo Router (TypeScript) |
| Backend | Supabase (Postgres, Auth, Storage, Realtime) |
| Video calls | Agora |
| Payments | Google Play Billing (prepaid subscriptions) |
| Builds | EAS Build (Android App Bundle and preview APK) |

### Run it

```bash
npm ci
# create a .env file with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
                         # (the public key only, never the service role key)
npm run android          # run on an emulator or connected phone
```

### Check it

```bash
npm run lint
npm run build            # TypeScript check
npm test -- --ci         # Jest tests
bash supabase/tests/run.sh   # database tests, on a disposable Postgres 16 only
```

### Build for Google Play

```bash
npm run build:bundle     # production .aab
npm run build:apk        # test .apk
```

### Where things are

```text
mobile/app/          Screens (auth, tabs, chat, calls, settings, premium...)
mobile/src/          Components, services, context, hooks
supabase/migrations/ Database changes (forward-only: add files, never edit old ones)
supabase/tests/      Database security and regression tests
__tests__/           App tests
docs/                Guides: calls, billing, plans, push, deployment, device tests
```

Good places to start: `docs/CALLS.md`, `docs/PLAN_CATALOG.md`, `docs/DEPLOYMENT_RUNBOOK.md` and `docs/DEVICE_TEST_PLAN.md`.

---

## Contributing

1. Create a branch from `main`.
2. Add tests for every change.
3. Make sure `npm run lint`, `npm run build` and `npm test -- --ci` pass.
4. Open a pull request.

---

© Chahat. All rights reserved.
