# The relay image runs the self-contained bundle built by `bun run --cwd packages/relay build`
# (dist/relay.js inlines @thinkrail/contracts), so the image needs no workspace install.
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY packages/relay/dist/relay.js ./relay.js
ENV PORT=24243 HOST=0.0.0.0
EXPOSE 24243
USER bun
CMD ["bun", "relay.js"]
