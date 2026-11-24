#!/bin/sh
# Installs (or updates) taskr in the Herdr app's home: the layout, its picture,
# its theme and its mod. Copies, not links: Herdr only hot-reloads files saved
# inside its own folder.
#
# Usage: ./install.sh              install or update
#        ./install.sh --keys       also add taskr's shortcuts to keys.json (never replaces yours)
#        ./install.sh --uninstall  remove taskr (your tasks in data/taskr stay)
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
HOME_DIR=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}
KEYS=0
for arg in "$@"; do
  case $arg in
    --keys) KEYS=1 ;;
    --uninstall) MODE=uninstall ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -d "$HOME_DIR" ]; then
  echo "No Herdr app home at $HOME_DIR (start Herdr once, or set HERDR_APP_HOME)." >&2
  exit 1
fi

if [ "${MODE:-}" = "uninstall" ]; then
  rm -rf "$HOME_DIR/mods/taskr" "$HOME_DIR/layouts/taskr.json" "$HOME_DIR/layouts/taskr.svg" "$HOME_DIR/themes/taskr.json"
  echo "taskr removed. Your tasks are still in $HOME_DIR/data/taskr/tasks.json."
  echo "Its shortcuts, if you added them, are the \"layout:taskr\" section of keys.json: harmless, or delete it."
  exit 0
fi

# A taskr that isn't this one (someone else's mod with the same name) is never overwritten.
if [ -e "$HOME_DIR/mods/taskr" ] && [ ! -L "$HOME_DIR/mods/taskr" ] && [ ! -f "$HOME_DIR/mods/taskr/.taskr" ]; then
  echo "$HOME_DIR/mods/taskr exists and isn't taskr: rename it first." >&2
  exit 1
fi

# Older installs linked these; replace links with copies.
for p in mods/taskr layouts/taskr.json themes/taskr.json; do
  if [ -L "$HOME_DIR/$p" ]; then rm "$HOME_DIR/$p"; fi
done

mkdir -p "$HOME_DIR/mods/taskr" "$HOME_DIR/layouts" "$HOME_DIR/themes"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude 'jsconfig.json' --exclude '*.d.ts' --exclude '.taskr' "$SRC/mods/taskr/" "$HOME_DIR/mods/taskr/"
else
  find "$HOME_DIR/mods/taskr" -mindepth 1 ! -name 'jsconfig.json' ! -name '*.d.ts' -exec rm -rf {} + 2>/dev/null || true
  cp -R "$SRC/mods/taskr/." "$HOME_DIR/mods/taskr/"
fi
touch "$HOME_DIR/mods/taskr/.taskr"
cp "$SRC/layouts/taskr.json" "$SRC/layouts/taskr.svg" "$HOME_DIR/layouts/"
cp "$SRC/themes/taskr.json" "$HOME_DIR/themes/taskr.json"

# taskr was called tasker before 1.6: its install goes (only when it's ours, marked .tasker), and
# its shortcuts carry over to "layout:taskr". Your tasks come over by themselves on first start
# (from data/tasker, which stays as it was).
if [ -f "$HOME_DIR/mods/tasker/.tasker" ]; then
  rm -rf "$HOME_DIR/mods/tasker" "$HOME_DIR/layouts/tasker.json" "$HOME_DIR/layouts/tasker.svg" "$HOME_DIR/themes/tasker.json"
  echo "tasker (taskr's old name) removed; your tasks come over to data/taskr when taskr starts."
  if grep -q '"layout":"tasker"' "$HOME_DIR/shared.json" 2>/dev/null; then SHOWN_OLD=1; fi
fi
# The detail panel was "tasker-detail" too: a key moved before 1.7.11 kept that name.
if [ -f "$HOME_DIR/keys.json" ] && grep -q 'tasker' "$HOME_DIR/keys.json" && command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const keys = JSON.parse(fs.readFileSync(f, "utf8"));
    const rename = (v) => String(v).replace(/^tasker\./, "taskr.").replace(/^layout\.toggle:tasker-/, "layout.toggle:taskr-");
    const old = keys["layout:tasker"];
    const mine = keys["layout:taskr"] ?? {};
    let n = 0;
    for (const [k, v] of Object.entries(mine)) if (rename(v) !== v) { mine[k] = rename(v); n++; }
    if (old) for (const [k, v] of Object.entries(old)) mine[k] ??= rename(v);
    if (!old && !n) process.exit(0);
    keys["layout:taskr"] = mine;
    delete keys["layout:tasker"];
    fs.writeFileSync(f, JSON.stringify(keys, null, 2) + "\n");
    console.log(old ? "Shortcuts moved from layout:tasker to layout:taskr." : "Shortcuts with tasker'"'"'s old names renamed.");' "$HOME_DIR/keys.json"
fi

# Shortcuts: taskr's "layout:taskr" keys are added; a key you already bound there stays yours.
if [ "$KEYS" = 1 ]; then
  MERGE='
    const fs = require("fs");
    const [mine, theirs] = process.argv.slice(1);
    const add = JSON.parse(fs.readFileSync(theirs, "utf8"));
    const keys = fs.existsSync(mine) ? JSON.parse(fs.readFileSync(mine, "utf8")) : {};
    const kept = [];
    for (const [section, map] of Object.entries(add)) {
      keys[section] ??= {};
      for (const [k, v] of Object.entries(map)) {
        if (keys[section][k] && keys[section][k] !== v) kept.push(`${section} ${k} (${keys[section][k]})`);
        else keys[section][k] = v;
      }
    }
    fs.writeFileSync(mine, JSON.stringify(keys, null, 2) + "\n");
    console.log(kept.length ? `Kept your own: ${kept.join(", ")}` : "Shortcuts added.");'
  if command -v node >/dev/null 2>&1; then
    node -e "$MERGE" "$HOME_DIR/keys.json" "$SRC/keys.json"
  else
    echo "Adding shortcuts needs node: merge $SRC/keys.json into $HOME_DIR/keys.json by hand." >&2
  fi
fi

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$HOME_DIR/mods/taskr"
fi
# The layout on screen was tasker's: show taskr's in its place.
if [ "${SHOWN_OLD:-0}" = 1 ] && command -v herdr-app >/dev/null 2>&1; then
  herdr-app do layout.switch '{"name":"taskr"}' >/dev/null 2>&1 || true
fi
echo "taskr installed. Pick it in Settings → Look, or: herdr-app do layout.switch '{\"name\":\"taskr\"}'"
