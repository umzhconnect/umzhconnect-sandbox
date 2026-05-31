FROM alpine:3.19

RUN apk add --no-cache curl openssl

COPY bundles/ /seed/bundles/

ENTRYPOINT ["/bin/sh", "/seed/seed.sh"]
