# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4 AS build
WORKDIR /src
ENV HUSKY=0
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
RUN bun run build:binary

FROM debian:13.7-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash ca-certificates curl git openssh-client tini \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --uid 1000 --shell /bin/bash thinkrail \
	&& install -d -o thinkrail -g thinkrail /workspace
COPY --from=build /src/apps/cli/dist/thinkrail /usr/local/bin/thinkrail
USER thinkrail
WORKDIR /workspace
ENV SHELL=/bin/bash \
	THINKRAIL_HOST=0.0.0.0 \
	THINKRAIL_PORT=24242
EXPOSE 24242
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
	CMD curl -fsS "http://127.0.0.1:${THINKRAIL_PORT}/health" || exit 1
ENTRYPOINT ["tini", "--", "thinkrail", "--no-open"]
