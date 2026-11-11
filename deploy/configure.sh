#!/bin/sh
# Run on the server, once, to enter the sign-in settings. It asks for the
# Google client ID and secret and the administrator email addresses, and
# stores them in ~/morse-contest.env (readable only by this account).
#
# Nothing typed here is shown on screen for the secret, and nothing is sent
# anywhere: the values only go into that file.
#
# Usage, from your own computer:
#   ssh -t morse-host "sh morse-contest/deploy/configure.sh"

ENV_FILE="$HOME/morse-contest.env"
umask 077
touch "$ENV_FILE"

# set_value NAME VALUE: replaces the line for NAME, or adds it.
set_value() {
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.new" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
}
current() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

echo "Morse contest: sign-in settings"
echo "Press Enter to keep a value that is already set."
echo

printf 'Public address of the site [%s]: ' "$(current BASE_URL || true)"
read -r BASE
[ -n "$BASE" ] && set_value BASE_URL "$BASE"
[ -z "$(current BASE_URL)" ] && set_value BASE_URL "https://morse.viljar.ee"

printf 'Google client ID [%s]: ' "$(current GOOGLE_CLIENT_ID || true)"
read -r CLIENT_ID
[ -n "$CLIENT_ID" ] && set_value GOOGLE_CLIENT_ID "$CLIENT_ID"

if [ -n "$(current GOOGLE_CLIENT_SECRET)" ]; then HAVE="already set"; else HAVE="not set"; fi
printf 'Google client secret (hidden while typing) [%s]: ' "$HAVE"
stty -echo 2>/dev/null
read -r CLIENT_SECRET
stty echo 2>/dev/null
echo
[ -n "$CLIENT_SECRET" ] && set_value GOOGLE_CLIENT_SECRET "$CLIENT_SECRET"

printf 'Administrator emails, separated by commas [%s]: ' "$(current ADMIN_EMAILS || true)"
read -r ADMINS
[ -n "$ADMINS" ] && set_value ADMIN_EMAILS "$(printf '%s' "$ADMINS" | tr -d ' ')"

# Settings that need no input.
[ -z "$(current DATA_FILE)" ] && set_value DATA_FILE "$HOME/morse-contest-data/store.json"
if [ -z "$(current APP_SECRET)" ]; then
  OLD="$(current PASS_SECRET)"
  if [ -n "$OLD" ]; then
    set_value APP_SECRET "$OLD"
  else
    set_value APP_SECRET "$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  fi
fi

chmod 600 "$ENV_FILE"
echo
echo "Saved. Settings now present (secrets not shown):"
sed 's/^\(GOOGLE_CLIENT_SECRET\|APP_SECRET\|PASS_SECRET\)=.*/\1=(set)/' "$ENV_FILE"
echo
echo "Address to register in Google Cloud Console as an authorised redirect URI:"
echo "  $(current BASE_URL)/auth/google/callback"
