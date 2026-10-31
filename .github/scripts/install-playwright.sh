#!/usr/bin/env bash
# Install Playwright's Chromium headless shell, retrying the network download a bounded number of times.
install() {
	for attempt in 1 2 3; do
		bunx playwright install --only-shell chromium && return 0
		echo "::warning::Playwright install failed on attempt $attempt"
		sleep 20
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
			install
			echo $? > "$status.tmp" && mv "$status.tmp" "$status"
		) > "$log" 2>&1 &
		echo $! > "$pid"
		;;
	wait)
		deadline=$((SECONDS + 240))
		until [ -f "$status" ]; do
			if ! kill -0 "$(cat "$pid")" 2> /dev/null && [ ! -f "$status" ]; then
				cat "$log"
				echo "::error::Playwright install exited without a status"
				exit 1
			fi
			if [ "$SECONDS" -ge "$deadline" ]; then
				cat "$log"
				echo "::error::Playwright install still running after 240 s"
				exit 1
			fi
			sleep 1
		done
		cat "$log"
		exit "$(cat "$status")"
		;;
	*)
		echo "usage: $0 start|wait" >&2
		exit 2
		;;
esac
