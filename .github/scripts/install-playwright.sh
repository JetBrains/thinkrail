#!/usr/bin/env bash
# Install Playwright's Chromium, retrying the network download a bounded number of times.
for attempt in 1 2 3; do
	bunx playwright install --with-deps chromium && exit 0
	echo "::warning::Playwright install failed on attempt $attempt"
	sleep 20
done
exit 1
