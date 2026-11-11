# Morse Contest — concept and workflow

Status: draft for discussion. Nothing is built yet.
Items marked **(proposed)** are my recommendation and are open to change. Section 9 lists what is decided and what is still open.

## 1. The idea in one paragraph

A web platform for learning Morse code by ear, where practice is a shared, timed event. At a fixed start time everyone in the room hears exactly the same Morse feed and types what they hear. A session lasts about 30 minutes. When it ends, each participant gets a personal result (accuracy, weak characters) and everyone sees the same scoreboard. The contest element gives a reason to show up regularly; the personal result is what makes it a learning tool.

## 2. What a participant experiences

1. **Sign in** with a Google account. On first sign-in, picks a display name (a callsign is fine) and a language, Estonian or English.
2. **Choose a room.** Picks a level. The beginner room is open to everyone; harder rooms are locked until their solo qualification test is passed (section 5).
3. **Lobby.** Sees the schedule of fixed session times, the next session, a countdown, and who else has joined. Does a sound check here: plays a test tone, sets volume and pitch, and types a few practice characters so the keyboard and audio are confirmed working before the start.
4. **Start.** At 0:00 the feed begins for everyone at the same moment.
5. **Copying.** Morse plays in groups (5 random characters, a word, or a callsign) with a pause after each. The participant types the group and it is locked in when the next group begins. No corrections after that. The screen shows only progress and time left, not whether the answers were right, and not other people's scores.
6. **Breaks.** The 30 minutes are split into rounds with short pauses (see section 4).
7. **Result.** Immediately after the last round: own score, accuracy, the sent text next to the typed text with errors highlighted, and a per-character breakdown ("you confuse B and D", "you miss Q").
8. **Scoreboard.** Ranking of everyone in the session, plus a long-term table across sessions.

## 3. How "everyone gets the same feed" works

**(proposed)** The server does not stream audio. It sends the *text and timing*, and each browser generates the tone locally.

- The server generates the session content in advance and is the only authority on what was sent and when.
- Each browser measures its clock offset to the server with a few quick requests, so "group 17 starts at 12:04:31.250" means the same instant for everyone.
- The browser produces the dits and dahs with the Web Audio API, which gives a clean tone, exact timing, and lets each person choose their own pitch and volume.
- Content is delivered a few seconds ahead of playback, not all at once, so the answer is not sitting in the browser for the whole session.
- Because sessions start on a fixed schedule and the timeline is fully known in advance, ordinary HTTPS requests every few seconds are enough to fetch upcoming content and send answers. No permanent live connection (WebSocket) is required, which matters on shared hosting (section 7).
- Typed answers go to the server with the group number. The server only accepts an answer during that group's window, and does all scoring.

Why this instead of an audio stream: an audio stream has seconds of unpredictable delay per listener, needs far more bandwidth, and makes it hard to tie a keystroke to a character. Text-and-timing makes sync tight to a few tens of milliseconds and one small server can carry hundreds of participants.

Edge cases:

- **Late join:** enters at the next group. Missed groups score zero for ranking; accuracy is reported only over groups actually attempted.
- **Dropped connection:** reconnects and resumes at the current position. Missed groups are treated as above.
- **Cheating:** a determined person can always run a decoder next to the browser. The design makes casual cheating awkward (just-in-time delivery, server-side scoring, answer windows) and does not try to do more. This is a learning tool.

## 4. Session structure

**(proposed)** 30 minutes = 6 rounds of 4 minutes, with 1 minute of rest between them.

| Round | Content | Purpose |
|---|---|---|
| 1 | Warm-up, slower, familiar characters | Settle in; counts for less |
| 2–3 | Random 5-character groups | Pure character recognition |
| 4 | Common words and Q-codes / abbreviations | Reading by ear in context |
| 5 | Callsigns | Real on-air skill |
| 6 | Sprint: speed rises step by step | Separates the top of the table |

Thirty minutes of unbroken copying is tiring enough that accuracy drops for reasons unrelated to skill, which is why rounds are suggested.

## 5. Levels — the main design question

Learners differ enormously: a beginner knows 4 characters at slow spacing, an experienced operator copies 30 WPM. One feed cannot suit both.

**Decided:** rooms by level. Each room has its own feed, all rooms start at the same time, and each has its own scoreboard.

- Characters are taught in the Koch order (start with two characters, add one at a time).
- Characters are sent at full speed (about 20 WPM) with extra spacing between them (Farnsworth timing), so learners hear each character as a sound shape and never count dits.

| Room | Characters | Speed (character / overall) | Who may join |
|---|---|---|---|
| Beginner | first 10 of the Koch order | 20 / 8 WPM | Everyone |
| Intermediate | first 20 | 20 / 12 WPM | Those who passed the intermediate test |
| Advanced | all 41 (letters, digits, punctuation) | 20 / 18 WPM | Those who passed the advanced test |

**Decided: qualification.** The beginner room is open to everyone. A harder room opens only after passing its qualification test alone:

- The test is taken solo, at the room's own character set and speed, and is run and scored by the server like a contest session.
- Every character of the room is sent the same number of times (about 100 characters in total), so all of them are actually tested.
- At least 75% of the characters must be copied correctly. The test can be retaken as often as needed.
- A pass for a harder room also opens the easier ones.
- Until accounts exist, the proof of passing is a signed token kept in the browser, valid for 180 days. Once sign-in is built it will be stored with the account instead.

The numbers (characters per room, speeds, the 75% threshold) are settings in one file and easy to change.

**Decided: Morse table.** The full Morse table is shown beside the page and can be hidden so it does not distract; the choice is remembered. Characters not used in the current room are dimmed.

The alternative is a single feed for everyone that climbs in difficulty, where beginners simply drop off partway. Simpler to build, worse for learning.

## 6. Scoring

**(proposed)**

- Each group is compared with what was typed using an alignment (edit distance), so one missed character costs one character and does not shift everything after it into errors.
- Points = correct characters, weighted by the speed of the round. Faster rounds are worth more.
- Session score is the sum over rounds. Ties are broken by accuracy.
- Stored per participant per session: score, accuracy, and which characters were mistaken for which. That history drives the progress page and the level suggestion.

## 7. Technical outline

The server is a **Hetzner Webhosting L** account. This is shared, managed hosting, not a server you administer: there is no root access, you cannot install system packages, and Hetzner runs the web server. What the plan does include, per Hetzner's documentation: Node.js apps (switched on per domain in konsoleH and kept running), SSH login, MariaDB and Postgres databases (2 of 20 used), cron jobs, free Let's Encrypt certificates and unlimited subdomains.

| Part | Choice | Reason |
|---|---|---|
| Address | `morse.viljar.ee` (new subdomain) | Hetzner switches off PHP and static sites on a domain when Node.js is enabled for it, so the app must not share a domain with the portfolio at `www.viljar.ee` |
| Server | One Node.js + TypeScript app, run by us on a local port behind the web server | One language for server and browser |
| Data | One JSON file on the hosting account, behind a single storage module | Ample for a group of friends, needs no database service, trivial to back up. Can be swapped for MariaDB later without touching the rest (changed from the original MariaDB plan) |
| Browser | TypeScript + Svelte, Web Audio API | Small pages, precise audio |
| Client–server traffic | Plain HTTPS requests | WebSockets do not pass through the hosting (tested) |
| Sign-in | Google sign-in (OAuth) | Decided; no passwords stored by us |
| Languages | Estonian and English, switchable | Decided |

### Hosting check results (11 November 2026)

Tested with the small app in `hosting-check/`, served at https://morse.viljar.ee while the test ran.

| Question | Result |
|---|---|
| Node.js on the server | Yes, version 24, with npm and git |
| konsoleH "Node.js Configuration" | **Not usable for us.** It applies to the whole of `viljar.ee`, subdomains included, and would switch off the portfolio |
| Running the app ourselves and forwarding the subdomain to it | **Works.** A two-line `.htaccess` in `public_html/morse` forwards requests to the app on a local port |
| HTTPS on the subdomain | Works, Let's Encrypt certificate issued |
| Request round trip | About 0.12–0.15 s, fine for clock sync |
| WebSockets | **Do not get through** the forwarding. The design uses plain HTTPS requests, so this is not a problem |
| Memory | No limit visible to the process; the app idles at about 55 MB |
| Does the host leave the process running? | **Test running.** Started 11 November 2026 18:21 UTC as process 94793, stops by itself after 24 hours. If `uptimeSeconds` on the page keeps counting from that start, the host leaves it alone |

Consequence: the app is started and kept alive by us (a cron job that starts it at boot and restarts it if it stops), not by konsoleH. If Hetzner turns out to stop long-running processes, the fallbacks are a separate domain with konsoleH's Node.js switch, or a small Hetzner Cloud server (around €4–5 per month).

## 8. Development and deployment workflow

```
VS Code on this PC  ──git push──▶  GitHub (private repo)
        │
        └── deploy script over SSH ──▶  Hetzner Webhosting L  (git pull, install, build, restart)
```

- **Code:** written and run locally in VS Code in this folder (`HAM Morse`). The whole app runs on `localhost` for testing, including simulated participants, before anything goes to the hosting account.
- **Repository:** one private GitHub repo holding the app and this document.
- **Deploy:** a short script that logs in over SSH, pulls the tagged version, installs dependencies, builds, and restarts the app.
- **One-time setup in konsoleH:** subdomain and SSL are done. No database is needed for now.
- **Secrets** (database password, Google sign-in secret, session signing key) live in a file on the hosting account or in konsoleH's environment variables. They are never put in the repo or in chat.

**candalf is not usable here.** It works by logging in as root to install packages and reconfigure the system, and shared hosting gives no root access. There is also nothing for it to manage, since Hetzner maintains the system. It would only come back into the picture if the project moves to a Hetzner Cloud server.

**Google sign-in needs one setup step from you:** creating an OAuth client in Google Cloud Console for `morse.viljar.ee`, which produces a client ID and a secret. They are entered on the server with `deploy/configure.sh`, which stores them in a file only the hosting account can read.

### Accounts, saved results and administration

- **Sign-in:** Google only. No passwords are handled or stored by us. Being signed in is remembered for 30 days in a signed cookie.
- **Account:** created on first sign-in. Holds the display name (a callsign is fine, changeable), the email from Google, the role, the qualification level, and whether the account is blocked.
- **Saved per account:** every contest session and every qualification test: date, room, points, accuracy, place, and per-character counts. A passed test raises the account's qualification, so it follows the person to any device.
- **"My results" page:** totals (sessions, average and best accuracy, wins), the characters with the lowest accuracy over all saved sessions, and the full history.
- **Administration page**, for administrators only: list of all users with role, qualification, session count, average accuracy and last sign-in. Actions: view a user's results, rename, block or unblock, grant or remove the administrator role, set the qualification level directly, delete the user with all their results.
- **Who is an administrator:** the email addresses listed in the server settings always are, and cannot be demoted from the page. They can appoint others.
- **Blocked** accounts can sign in but cannot join rooms or take tests.

## 9. Decisions

Decided:

| Topic | Decision |
|---|---|
| Levels | Rooms by level |
| Schedule | Fixed session times |
| Sign-in | Google |
| Audience | Friends first |
| Languages | Estonian and English |
| Hosting | Hetzner Webhosting L, new subdomain |

Still open (the proposed default applies unless you say otherwise):

1. **Session shape:** rounds with breaks as in section 4 **(proposed)**, or one continuous 30 minutes.
2. **Session times:** which days and what time. **(proposed)** one daily session at 20:00 Estonian time to start with.
3. **Who may join:** anyone with a Google account who has the link **(proposed)**, or only people on an invite list.
4. **Callsign:** optional field on the profile **(proposed)**.
5. **GitHub repo:** private, named `morse-contest` **(proposed)**.

## 10. Suggested build order

0. **Hosting check** — hello-world Node.js app on `morse.viljar.ee` to settle the unknowns in section 7.
1. **Morse engine** — text to timing, tone playback in the browser, Koch/Farnsworth settings. Usable alone as a solo trainer.
2. **Single-room session** — lobby, synchronized start, typing, server scoring, result page. Tested locally with several browser windows.
3. **Sign-in and saved results** — Google sign-in, accounts, results saved per account, administration page. *(built; goes live once the Google client is set up)*
4. **First deployment** — deploy script, first real session with a few friends. *(the version without sign-in is live at morse.viljar.ee)*
5. **Levels, rounds and schedule** — multiple rooms, round types, fixed timetable, per-character statistics, level suggestions.
6. **Polish** — both languages complete, progress charts, mobile layout.
