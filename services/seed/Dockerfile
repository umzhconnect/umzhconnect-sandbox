FROM alpine:3.19

# Set BUILD_INSECURE=1 (build arg) to fetch packages over the http mirror — a
# local escape hatch for networks with a TLS-intercepting proxy. Unset in CI,
# so the default https mirror is used.
ARG BUILD_INSECURE=
RUN if [ -n "$BUILD_INSECURE" ]; then sed -i 's|https://|http://|g' /etc/apk/repositories; fi \
 && apk add --no-cache curl openssl

COPY bundles/ /seed/bundles/

ENTRYPOINT ["/bin/sh", "/seed/seed.sh"]
