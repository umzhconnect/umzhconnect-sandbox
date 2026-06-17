FROM alpine:3.19

# Set APK_INSECURE=1 (build arg) to fetch packages over the http mirror — a
# local escape hatch for networks with a TLS-intercepting proxy. Unset in CI,
# so the default https mirror is used.
ARG APK_INSECURE=
RUN if [ -n "$APK_INSECURE" ]; then sed -i 's|https://|http://|g' /etc/apk/repositories; fi \
 && apk add --no-cache curl

COPY load-flows.sh /load-flows.sh
RUN chmod +x /load-flows.sh

ENTRYPOINT ["/bin/sh", "/load-flows.sh"]
