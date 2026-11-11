#!/usr/bin/env bash
# Download Playwright's Chromium headless shell (plus WebKit with `start webkit`), retrying a bounded number of
# times. WebKit's system libraries come from `.github/actions/apt-packages`; `wait webkit` proves it launches.
install() {
	for attempt in 1 2 3; do
		bunx playwright install --only-shell chromium &&
			{ [ "${2:-}" != webkit ] || bunx playwright install webkit; } && return 0
		echo "::warning::Playwright download failed on attempt $attempt"
		sleep 10
	done
	return 1
}

status="$RUNNER_TEMP/playwright-install.status"
log="$RUNNER_TEMP/playwright-install.log"
pid="$RUNNER_TEMP/playwright-install.pid"
case "${1:-}" in
	start)
		rm -f "$status"
		(
			export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
			install "$@"
			echo $? > "$status.tmp" && mv "$status.tmp" "$status"
		) > "$log" 2>&1 &
		echo $! > "$pid"
		;;
	wait)
		deadline=$((SECONDS + 420))
		until [ -f "$status" ]; do
			if ! kill -0 "$(cat "$pid")" 2> /dev/null && [ ! -f "$status" ]; then
				cat "$log"
				echo "::error::Playwright install exited without a status"
				exit 1
			fi
			if [ "$SECONDS" -ge "$deadline" ]; then
				cat "$log"
				echo "::error::Playwright install still running after 420 s"
				exit 1
			fi
			sleep 1
		done
		cat "$log"
		[ "$(cat "$status")" = 0 ] || exit "$(cat "$status")"
		if [ "${2:-}" = webkit ] &&
			! bun -e 'const { webkit } = await import("@playwright/test"); await (await webkit.launch()).close();'; then
			echo "::error::WebKit cannot launch; add its missing libraries to .github/actions/apt-packages/webkit.txt"
			exit 1
		fi
		;;
	*)
		echo "usage: $0 start [webkit]|wait [webkit]" >&2
		exit 2
		;;
esac
