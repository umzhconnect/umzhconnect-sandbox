FROM curlimages/curl:8.5.0

COPY seed.sh /seed.sh
COPY bundles/ /seed/bundles/

ENTRYPOINT ["/bin/sh", "/seed.sh"]
