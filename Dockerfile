FROM debian:trixie-slim

# renovate: datasource=github-releases depName=jdx/mise
ARG MISE_VERSION=2026.10.22
# renovate: datasource=github-releases depName=jdx/pitchfork
ARG PITCHFORK_VERSION=2.32.3
# renovate: datasource=github-releases depName=mikefarah/yq
ARG YQ_VERSION=4.54.1
ARG TARGETARCH

# Base tools for agents and the entrypoint. Anything else comes from mise:
# tools from [tools], extra apt packages from [bootstrap.packages].
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    gosu \
    gzip \
    jq \
    less \
    openssh-client \
    procps \
    ripgrep \
    tar \
    unzip \
    xz-utils \
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Packages from [bootstrap.packages] come without recommends; openssh-server
# would otherwise pull in dbus, xauth and more
RUN printf 'APT::Install-Recommends "false";\nAPT::Install-Suggests "false";\n' \
        > /etc/apt/apt.conf.d/99container-agent

# mise, pitchfork and yq are pinned here (Renovate bumps them) instead of
# self-updating on start, so a new release cannot break a running setup
RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) mise_arch=x64; pf_arch=x86_64 ;; \
        arm64) mise_arch=arm64; pf_arch=aarch64 ;; \
        *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    gh=https://github.com; \
    curl -fsSL -o /usr/local/bin/mise \
        "${gh}/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${mise_arch}"; \
    curl -fsSL "${gh}/jdx/pitchfork/releases/download/v${PITCHFORK_VERSION}/pitchfork-${pf_arch}-unknown-linux-gnu.tar.gz" \
        | tar -xz -C /usr/local/bin pitchfork; \
    curl -fsSL -o /usr/local/bin/yq \
        "${gh}/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${TARGETARCH}"; \
    chmod +x /usr/local/bin/mise /usr/local/bin/pitchfork /usr/local/bin/yq; \
    mise --version; pitchfork --version; yq --version

COPY image/mise.toml /etc/mise/config.toml
COPY modules /etc/container-agent/modules
COPY image/container-agent image/agent-run /usr/local/bin/

ENV AGENT_USER=agent \
    PUID=1000 \
    PGID=1000 \
    AGENT_WORKSPACE=/repos \
    AUTO_UPDATE=true \
    PITCHFORK_SUPERVISOR_AUTO_START=false

# Executables of the enabled modules and the mise shims of the agent user, both
# linked on start, so `docker exec` finds the tools without a login shell
ENV PATH="/run/container-agent/bin:/run/container-agent/shims:${PATH}"

HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD ["container-agent", "health"]

WORKDIR /repos

ENTRYPOINT ["container-agent"]
CMD ["start"]
