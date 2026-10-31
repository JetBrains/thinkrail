#!/usr/bin/env bash
# Download Electrobun's Hutch toolchain into ~/.hutch, retrying the GitHub release downloads a bounded number of times.
cd "$(dirname "$0")/../../apps/desktop" || exit 1
for attempt in 1 2 3; do
	bun run electrobun prepare && exit 0
	echo "::warning::Electrobun toolchain download failed on attempt $attempt"
	sleep 20
done
exit 1
