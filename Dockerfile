FROM node:20-bookworm-slim AS node_runtime
FROM rocker/r-ver:4.4.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 libseccomp2 build-essential gfortran ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY scripts/install-r-packages.R /tmp/install-r-packages.R
RUN Rscript --vanilla /tmp/install-r-packages.R && rm /tmp/install-r-packages.R

WORKDIR /app
COPY package.json .
COPY scientific ./scientific
COPY scripts/run-scientific.mjs ./scripts/run-scientific.mjs
RUN chmod 700 /app && install -d -m 0711 /tmp/power-agent-scientific
ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/scripts/run-scientific.mjs"]
