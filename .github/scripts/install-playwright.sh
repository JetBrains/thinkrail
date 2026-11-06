#!/usr/bin/env bash
# Install Playwright's Chromium headless shell (plus WebKit and its system libraries, without Playwright's
# optional font and X-server group, with `start webkit`), retrying the download a bounded number of times.
webkit() {
	bunx playwright install webkit && sudo apt-get update -q || return 1
	local report
	local -a missing
	report=$(bunx playwright install-deps --dry-run webkit 2>&1)
	case "$report" in
	*"All system dependencies are installed"*) return 0 ;;
	*"Missing system dependencies"*) ;;
	*)
		echo "$report"
		return 1
		;;
	esac
	mapfile -t missing < <(sed -n 's/^  //p' <<< "$report" | grep -vE '^(fonts-|xfonts-|ttf-|xvfb$)')
	[ "${#missing[@]}" -eq 0 ] || sudo apt-get install -y --no-install-recommends "${missing[@]}"
}
install() {
	[ "${2:-}" != webkit ] ||
		printf 'Acquire::Retries "5";\nAcquire::http::Timeout "20";\n' |
		sudo tee /etc/apt/apt.conf.d/80-playwright-retries > /dev/null
	for attempt in 1 2 3; do
		bunx playwright install --only-shell chromium &&
			{ [ "${2:-}" != webkit ] || webkit; } && return 0
		echo "::warning::Playwright install failed on attempt $attempt"
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
		exit "$(cat "$status")"
		;;
	*)
		echo "usage: $0 start [webkit]|wait" >&2
		exit 2
		;;
esac
