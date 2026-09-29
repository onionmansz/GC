#!/bin/sh
# Container entry point. Assisted checks (Sport Chek) use a normal, visible Chrome, so
# start a virtual display first. If it can't start, run anyway: Chrome then runs
# headless (Indigo is unaffected; assisted checks may be refused more often).
# (Not xvfb-run: it hangs when it is the container's first process.)
if command -v Xvfb >/dev/null 2>&1; then
  Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 &
  i=0
  while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  if [ -e /tmp/.X11-unix/X99 ]; then
    export DISPLAY=:99
    echo "virtual display ready"
  else
    echo "virtual display didn't start; running headless"
  fi
fi
exec npx tsx src/index.ts "$@"
