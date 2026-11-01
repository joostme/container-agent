FROM debian:trixie-slim

# renovate: datasource=github-releases depName=jdx/mise extractVersion=^v(?<version>.+)$
ARG MISE_VERSION=2026.10.22
# renovate: datasource=github-releases depName=jdx/pitchfork extractVersion=^v(?<version>.+)$
ARG PITCHFORK_VERSION=2.32.3
# renovate: datasource=github-releases depName=mikefarah/yq extractVersion=^v(?<version>.+)$
ARG YQ_VERSION=4.54.1
ARG TARGETARCH

# Only what fitout, mise and pitchfork need: downloads (curl, certificates),
# unpacking (unzip, xz; tar and gzip are part of Debian), jq and gosu for the
# entrypoint. Everything else comes from modules, e.g. git and compilers from
# the devtools module.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
    jq \
    unzip \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Packages from [bootstrap.packages] come without recommends; openssh-server
# would otherwise pull in dbus, xauth and more
RUN printf 'APT::Install-Recommends "false";\nAPT::Install-Suggests "false";\n' \
        > /etc/apt/apt.conf.d/99fitout

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

# The image carries no modules: fitout.toml in /etc/fitout names them, and
# the entrypoint downloads them from the catalog
COPY image/mise.toml /etc/mise/config.toml
COPY image/fitout /usr/local/bin/

# No PUID/PGID defaults here: they would always win over fitout.toml
ENV PITCHFORK_SUPERVISOR_AUTO_START=false

# Commands from the tasks of the enabled modules and the mise shims of the
# user, both made on start, so `docker exec` finds them without a login shell
ENV PATH="/run/fitout/bin:/run/fitout/shims:${PATH}"

HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD ["fitout", "health"]

WORKDIR /workspace

ENTRYPOINT ["fitout"]
CMD ["start"]
